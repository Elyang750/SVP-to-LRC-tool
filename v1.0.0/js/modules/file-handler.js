// ============================================================
// js/modules/file-handler.js
// ============================================================
import {
    cleanText,
    parseBpmIntervals,
    calculateRealTime,
    DEFAULT_BPM,
    filterValidNotes,
    findAllNoteArrays,
    annotateTrackNames,
    UNIT_PER_BEAT,
} from './utils.js';
import { renderSvpInfo, resetUploadArea, hideAllErrors, renderTrackSelector } from './ui-controller.js';

// DOM 元素引用
export let svpFileInput, fileUploadArea, uploadHintText, uploadFileName, fileError;

// 已解析的 SVP 数据
// 结构：{ svpJson, bpmIntervals, meter, trackList, selectedTrackIndices, notes, firstNoteOnset, noteCount }
export let cachedSvpData = null;

export function initFileElements() {
    svpFileInput = document.getElementById('svpFile');
    fileUploadArea = document.getElementById('fileUploadArea');
    uploadHintText = document.getElementById('uploadHintText');
    uploadFileName = document.getElementById('uploadFileName');
    fileError = document.getElementById('fileError');
}

export function handleFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) handleFiles(files);
}

export function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) handleFiles(files);
}

// ---------- 文件读取：gzip / UTF-16 / BOM 自动处理 ----------
async function readFileAsText(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
        try {
            const ds = new DecompressionStream('gzip');
            const stream = new Blob([buffer]).stream().pipeThrough(ds);
            return await new Response(stream).text();
        } catch (e) {
            throw new Error('gzip 解压失败：' + e.message);
        }
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(buffer.slice(2));
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(buffer.slice(2));
    }
    let text = new TextDecoder('utf-8').decode(buffer);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return text;
}

// ---------- 宽松 JSON 解析 ----------
function tryParseJson(text) {
    if (text == null) return null;
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    text = text.trim();
    const attempt = (label, str) => {
        try { return JSON.parse(str); }
        catch (e) { return undefined; }
    };
    let r;
    r = attempt('直接解析', text); if (r !== undefined) return r;
    r = attempt('去尾逗号', text.replace(/,(\s*[}\]])/g, '$1')); if (r !== undefined) return r;
    r = attempt('去注释',
        text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
            .replace(/,(\s*[}\]])/g, '$1'));
    if (r !== undefined) return r;
    // ★ 关键：SV1 文件里常有 NaN/Infinity/undefined
    const fixed = text
        .replace(/:\s*NaN\b/g, ': null').replace(/:\s*-?Infinity\b/g, ': null').replace(/:\s*undefined\b/g, ': null')
        .replace(/,\s*NaN\b/g, ', null').replace(/,\s*-?Infinity\b/g, ', null').replace(/,\s*undefined\b/g, ', null')
        .replace(/\[\s*NaN\b/g, '[null').replace(/\[\s*-?Infinity\b/g, '[null').replace(/\[\s*undefined\b/g, '[null')
        .replace(/,(\s*[}\]])/g, '$1');
    r = attempt('NaN替换', fixed); if (r !== undefined) return r;
    r = attempt('剥离控制字符', text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ''));
    if (r !== undefined) return r;
    try {
        const result = new Function('"use strict"; return (' + text + ');')();
        if (result && typeof result === 'object') return result;
    } catch (e) {}
    return null;
}

// ---------- 核心文件处理 ----------
export async function handleFiles(files) {
    hideAllErrors();
    const file = files[0];
    if (!validateSvpFile(file)) {
        if (fileError) fileError.style.display = 'block';
        resetUploadArea();
        cachedSvpData = null;
        return;
    }
    if (uploadHintText) uploadHintText.textContent = '已选择文件：';
    if (uploadFileName) uploadFileName.textContent = file.name;

    try {
        const svpText = await readFileAsText(file);

        // 解析基础信息（用于展示）
        const svpInfo = extractSvpInfo(svpText);
        renderSvpInfo(svpInfo);

        // 解析完整数据
        const svpData = parseSvpContent(svpText);
        cachedSvpData = svpData;

        // 渲染轨道选择器
        if (svpData && svpData.trackList && svpData.trackList.length > 1) {
            renderTrackSelector(svpData.trackList, svpData.selectedTrackIndices, selectTracks);
        } else if (svpData) {
            renderTrackSelector([], new Set(), null); // 清空
        }
    } catch (e) {
        alert('读取文件失败：' + e.message);
        console.error(e);
    }
}

// ---------- 用户在 UI 里切换轨道时调用 ----------
export function selectTracks(indices) {
    if (!cachedSvpData) return;
    cachedSvpData.selectedTrackIndices = new Set(indices);
    // 重新合并选中轨道的音符
    const allNotes = [];
    for (const idx of cachedSvpData.selectedTrackIndices) {
        const track = cachedSvpData.trackList[idx];
        if (track) allNotes.push(...track.notes);
    }
    allNotes.sort((a, b) => (Number(a.onset) || 0) - (Number(b.onset) || 0));
    const validNotes = filterValidNotes(allNotes);
    const notesWithRealTime = validNotes.map(note => {
        const onset = Number(note.onset) || 0;
        const duration = Number(note.duration) || 0;
        const realStartTime = calculateRealTime(onset, cachedSvpData.bpmIntervals);
        const realEndTime = calculateRealTime(onset + duration, cachedSvpData.bpmIntervals);
        return {
            onsetUnit: onset,
            realStartTime,
            realDuration: realEndTime - realStartTime,
            lyric: (note.lyrics ?? note.lyric ?? '').trim(),
            duration,
        };
    });
    cachedSvpData.notes = notesWithRealTime;
    cachedSvpData.firstNoteOnset = notesWithRealTime[0]?.realStartTime || 0;
    cachedSvpData.noteCount = notesWithRealTime.length;
}

// ---------- 提取展示信息 ----------
export function extractSvpInfo(svpText) {
    const cleanedText = cleanText(svpText);
    const info = {
        bpmInfo: '未知', meter: '未知', noteCount: 0, totalDuration: 0,
        voiceDatabase: '未知', sampleRate: '未知', error: '',
        trackSummary: '',
    };
    try {
        const svpJson = tryParseJson(cleanedText);
        if (!svpJson) throw new Error('无法解析为 JSON');
        const timeData = svpJson.time || {};

        const tempoArray = timeData.tempo || [];
        const bpmIntervals = parseBpmIntervals(tempoArray);
        if (bpmIntervals.length === 1) {
            info.bpmInfo = `${bpmIntervals[0].bpm} BPM（匀速）`;
        } else {
            info.bpmInfo = '变速：' + bpmIntervals.map(itv => `${itv.bpm} BPM`).join(' → ');
        }
        if (timeData.meter && timeData.meter.length > 0) {
            const meter = timeData.meter[0];
            info.meter = `${meter.numerator}/${meter.denominator}`;
        }

        // ★ 用递归查找代替只读 tracks[0].mainGroup
        const noteArrays = findAllNoteArrays(svpJson);
        const trackList = annotateTrackNames(svpJson, noteArrays);
        let totalNotes = 0;
        const summaries = [];
        for (const t of trackList) {
            const valid = filterValidNotes(t.notes);
            totalNotes += valid.length;
            summaries.push(`${t.name}（${valid.length}）`);
        }
        info.noteCount = totalNotes;
        info.trackSummary = summaries.join('，');

        // 时长：取所有音符中最晚的结束时间
        let latestEnd = 0;
        for (const t of trackList) {
            for (const note of t.notes) {
                const onset = Number(note.onset) || 0;
                const dur = Number(note.duration) || 0;
                const endSec = calculateRealTime(onset + dur, bpmIntervals);
                if (endSec > latestEnd) latestEnd = endSec;
            }
        }
        const threeDecimalRadio = document.getElementById('threeDecimal');
        const decimalCount = threeDecimalRadio?.checked ? 3 : 2;
        const minutes = Math.floor(latestEnd / 60);
        const seconds = (latestEnd % 60).toFixed(decimalCount);
        info.totalDuration = `${minutes}分${seconds}秒`;

        if (svpJson.tracks?.[0]?.mainRef?.database?.name) {
            info.voiceDatabase = svpJson.tracks[0].mainRef.database.name;
        }
        if (svpJson.renderConfig?.sampleRate) {
            info.sampleRate = `${svpJson.renderConfig.sampleRate} Hz`;
        }
    } catch (e) {
        info.error = `解析失败：${e.message}`;
    }
    return info;
}

// ---------- 解析 SVP 内容 ----------
export function parseSvpContent(svpText) {
    const cleanedText = cleanText(svpText);
    try {
        const svpJson = tryParseJson(cleanedText);
        if (!svpJson) throw new Error('文件不是合法的 JSON');
        const timeData = svpJson.time || {};

        const bpmIntervals = parseBpmIntervals(timeData.tempo || []);
        let meter = '4/4';
        if (timeData.meter && timeData.meter.length > 0) {
            meter = `${timeData.meter[0].numerator}/${timeData.meter[0].denominator}`;
        }

        // ★ 递归查找所有音符组
        const noteArrays = findAllNoteArrays(svpJson);
        if (noteArrays.length === 0) {
            throw new Error('未找到任何音符数组（已尝试 mainGroup 和音符组）');
        }
        const trackList = annotateTrackNames(svpJson, noteArrays);

        // 默认选中第一个音符组
        const selectedTrackIndices = new Set([0]);

        const result = {
            svpJson,
            bpmIntervals,
            meter,
            trackList,
            selectedTrackIndices,
            notes: [],
            firstNoteOnset: 0,
            noteCount: 0,
        };
        // 用 selectTracks 的逻辑初始化 notes
        cachedSvpData = result; // 临时赋值以便复用
        selectTracks(selectedTrackIndices);
        cachedSvpData = null;
        return result;
    } catch (e) {
        console.error('SVP解析错误：', e);
        throw e;
    }
}

export function validateSvpFile(file) {
    if (!file) return false;
    const fileExt = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    return fileExt === '.svp';
}
