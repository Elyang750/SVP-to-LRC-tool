// ============================================================
// js/modules/utils.js
// ============================================================

// ---------- 常量 ----------
export const UNIT_PER_BEAT = 705600000;
export const DEFAULT_BPM = 120;

export const SPECIAL_TOKENS = new Set(['-', 'cl', 'R', 'r', 'sil', 'br', 'brl', 'pau', '+']);
export const GAP_FOR_LINE_BREAK_MS = 500;
export const THRESHOLD_HIGH = 0.85;
export const THRESHOLD_MID = 0.65;

// ---------- 文本处理 ----------
export function cleanText(text) {
    text = text.replace(/^\uFEFF/, '');
    text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    return text;
}

// ---------- 音符过滤（宽松版：兼容 SV1/SV2） ----------
export function filterValidNotes(notes) {
    if (!Array.isArray(notes)) return [];
    return notes.filter(note => {
        if (!note) return false;
        const lyric = (note.lyrics ?? note.lyric ?? '').toString().trim();
        if (!lyric) return false;
        if (SPECIAL_TOKENS.has(lyric.toLowerCase())) return false;
        if (note.musicalType && note.musicalType !== 'singing') return false;
        return true;
    });
}

// ---------- BPM 区间解析（保留原接口，修复大写 I bug） ----------
export function parseBpmIntervals(tempoArray) {
    if (!Array.isArray(tempoArray) || tempoArray.length === 0) {
        return [{ start: 0, end: Infinity, bpm: DEFAULT_BPM }];
    }
    const sortedTempo = [...tempoArray].sort((a, b) => a.position - b.position);
    // 补一个 position=0 的区间（防止第一个 tempo 不是从 0 开始）
    if (sortedTempo[0].position > 0) {
        sortedTempo.unshift({ position: 0, bpm: sortedTempo[0].bpm });
    }
    const intervals = [];
    for (let i = 0; i < sortedTempo.length; i++) {
        const current = sortedTempo[i];
        const next = sortedTempo[i + 1];
        intervals.push({
            start: current.position,
            end: next ? next.position : Infinity,
            bpm: current.bpm || DEFAULT_BPM,
        });
    }
    return intervals;
}

// ---------- 计算真实时间（秒） ----------
export function calculateRealTime(onset, bpmIntervals) {
    let remainingOnset = onset;
    let totalSeconds = 0;
    for (const interval of bpmIntervals) {
        if (remainingOnset <= 0) break;
        const intervalLength = interval.end - interval.start;
        const currentOnsetInInterval = Math.min(remainingOnset, intervalLength);
        if (currentOnsetInInterval > 0) {
            const beats = currentOnsetInInterval / UNIT_PER_BEAT;
            totalSeconds += beats * (60 / interval.bpm);
        }
        remainingOnset -= currentOnsetInInterval;
    }
    return parseFloat(totalSeconds.toFixed(6));
}

// ---------- 时间输入解析 ----------
export function timeInputsToSeconds() {
    const timeMmInput = document.getElementById('timeMm');
    const timeSsInput = document.getElementById('timeSs');
    const timeMsInput = document.getElementById('timeMs');
    const threeDecimalRadio = document.getElementById('threeDecimal');
    const mm = Number(timeMmInput?.value || 0);
    const ss = Number(timeSsInput?.value || 0);
    const ms = Number(timeMsInput?.value || 0);
    const decimalCount = threeDecimalRadio?.checked ? 3 : 2;
    const msDivisor = decimalCount === 3 ? 1000 : 100;
    return mm * 60 + ss + ms / msDivisor;
}

// ---------- 时间格式化 ----------
export function secondsToLrcTime(seconds, decimalCount) {
    const totalSeconds = Math.max(0, seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const secs = totalSeconds - minutes * 60;
    const mm = String(minutes).padStart(2, '0');
    const ssInt = Math.floor(secs);
    const ssIntStr = String(ssInt).padStart(2, '0');
    if (decimalCount === 3) {
        const ssDec = Math.round((secs - ssInt) * 1000);
        return `[${mm}:${ssIntStr}.${String(ssDec).padStart(3, '0').slice(0, 3)}]`;
    } else {
        const ssDec = Math.round((secs - ssInt) * 100);
        return `[${mm}:${ssIntStr}.${String(ssDec).padStart(2, '0').slice(0, 2)}]`;
    }
}

// ============================================================
// 以下为新增功能
// ============================================================

// ---------- 音符基本读取 ----------
export function getLyric(note) {
    return String(note?.lyrics ?? note?.lyric ?? '').trim();
}
export function isSpecialToken(text) {
    return SPECIAL_TOKENS.has(text);
}
export function isNoteItem(item) {
    if (!item || typeof item !== 'object') return false;
    const onset = item.onset;
    if (onset === undefined || onset === null) return false;
    if (isNaN(Number(onset))) return false;
    return ('lyrics' in item) || ('lyric' in item);
}

// ---------- 递归查找所有音符数组（兼容 SV1/SV2） ----------
export function findAllNoteArrays(json) {
    const results = [];
    const visited = new WeakSet();
    function walk(node, path) {
        if (!node || typeof node !== 'object') return;
        if (visited.has(node)) return;
        visited.add(node);
        if (Array.isArray(node)) {
            if (node.length === 0) return;
            if (node.every(isNoteItem)) {
                results.push({ path, notes: node.slice() });
                return;
            }
            node.forEach((item, i) => walk(item, `${path}[${i}]`));
        } else {
            for (const key of Object.keys(node)) {
                walk(node[key], path ? `${path}.${key}` : key);
            }
        }
    }
    walk(json, '$');
    return results;
}

// ---------- 给每个音符数组关联轨道名 ----------
export function annotateTrackNames(json, noteArrays) {
    const trackById = new Map();
    if (Array.isArray(json.tracks)) {
        json.tracks.forEach((t, i) => {
            const name = t.name || `Track ${i + 1}`;
            for (const idField of ['id', 'uuid', 'ID']) {
                if (t[idField] !== undefined) trackById.set(String(t[idField]), name);
            }
        });
    }
    const groupToTrackName = new Map();
    for (const key of ['noteGroups', 'groups', 'noteGroupList']) {
        if (Array.isArray(json[key])) {
            json[key].forEach(g => {
                if (!g) return;
                const gid = g.id ?? g.uuid ?? g.ID;
                const tid = g.trackId ?? g.trackID ?? g.track_id;
                if (gid !== undefined && tid !== undefined && trackById.has(String(tid))) {
                    groupToTrackName.set(String(gid), trackById.get(String(tid)));
                }
            });
        }
    }
    return noteArrays.map((na, i) => {
        let name = null;
        const m = na.path.match(/\$\.tracks\[(\d+)\]/);
        if (m) {
            const idx = parseInt(m[1], 10);
            if (Array.isArray(json.tracks) && json.tracks[idx]) {
                name = json.tracks[idx].name || `Track ${idx + 1}`;
            }
        }
        if (!name) {
            const first = na.notes[0];
            const tid = first.trackId ?? first.trackID ?? first.track_id;
            if (tid !== undefined && trackById.has(String(tid))) name = trackById.get(String(tid));
        }
        if (!name) {
            const gm = na.path.match(/\$\.(noteGroups|groups|noteGroupList)\[(\d+)\]/);
            if (gm) {
                const key = gm[1], idx = parseInt(gm[2], 10);
                const g = json[key]?.[idx];
                if (g) {
                    const gid = g.id ?? g.uuid ?? g.ID;
                    if (gid !== undefined && groupToTrackName.has(String(gid))) {
                        name = groupToTrackName.get(String(gid));
                    } else if (g.name) {
                        name = g.name;
                    }
                }
            }
        }
        if (!name) {
            const segs = na.path.split(/[\.\[\]]+/).filter(Boolean);
            const last = segs[segs.length - 1];
            name = last && isNaN(Number(last)) ? last : `音符组 #${i + 1}`;
        }
        return { index: i, name, path: na.path, notes: na.notes, noteCount: na.notes.length };
    });
}

// ---------- 日语归一化 ----------
export function katakanaToHiragana(str) {
    return str.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}
export function normalizeJapanese(text) {
    let s = katakanaToHiragana(text.trim());
    s = s.replace(/ー/g, '');
    s = s.replace(/([^\s])は/g, '$1わ');
    return s;
}
export function normalizeVariants(text) {
    const base = normalizeJapanese(text);
    return { withSokuon: base, withoutSokuon: base.replace(/っ/g, '') };
}
export function hasKanaOrKanji(text) {
    return /[\u3040-\u30FF\u4E00-\u9FFF]/.test(text);
}

// ---------- 相似度（LCS + 汉字软匹配 + Dice 系数） ----------
function isKanji(ch) {
    const code = ch.charCodeAt(0);
    return (code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF);
}
function weightedLcs(a, b) {
    const m = a.length, n = b.length;
    if (m === 0 || n === 0) return 0;
    let prev = new Float64Array(n + 1);
    let curr = new Float64Array(n + 1);
    for (let i = 1; i <= m; i++) {
        const ca = a[i - 1];
        const aIsKanji = isKanji(ca);
        curr[0] = 0;
        for (let j = 1; j <= n; j++) {
            const cb = b[j - 1];
            const bIsKanji = isKanji(cb);
            let score;
            if (ca === cb) score = 1;
            else if (aIsKanji !== bIsKanji) score = 0.5;
            else score = 0;
            curr[j] = Math.max(prev[j], curr[j - 1], prev[j - 1] + score);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}
export function similarity(a, b) {
    if (!a && !b) return 1;
    const totalLen = a.length + b.length;
    if (totalLen === 0) return 1;
    return Math.min(1, (2 * weightedLcs(a, b)) / totalLen);
}

// ---------- DP 对齐 ----------
export function alignLyricsToNotes(userLines, notes) {
    const L = userLines.length, N = notes.length;
    if (L === 0 || N === 0) return [];
    const noteVariants = notes.map(n => normalizeVariants(getLyric(n)));
    const simCache = new Map();
    function cachedSim(a, b) {
        const key = a + '\x1f' + b;
        let v = simCache.get(key);
        if (v === undefined) { v = similarity(a, b); simCache.set(key, v); }
        return v;
    }
    const INF = Infinity;
    const dp = Array.from({ length: L + 1 }, () => new Array(N + 1).fill(INF));
    const parent = Array.from({ length: L + 1 }, () => new Array(N + 1).fill(null));
    dp[0][0] = 0;
    for (let i = 1; i <= L; i++) {
        for (let j = i; j <= N - (L - i); j++) {
            for (let k = i - 1; k < j; k++) {
                if (dp[i - 1][k] === INF) continue;
                let best = 0;
                for (const variant of ['withSokuon', 'withoutSokuon']) {
                    let str = '';
                    for (let t = k; t < j; t++) str += noteVariants[t][variant];
                    const sim = cachedSim(userLines[i - 1], str);
                    if (sim > best) best = sim;
                }
                const cost = dp[i - 1][k] + (1 - best);
                if (cost < dp[i][j]) {
                    dp[i][j] = cost;
                    parent[i][j] = { prevJ: k, noteStart: k, noteEnd: j - 1, similarity: best };
                }
            }
        }
    }
    const result = [];
    let i = L, j = N;
    while (i > 0 && parent[i][j]) {
        const p = parent[i][j];
        result.unshift({
            lineIndex: i - 1,
            noteStart: p.noteStart,
            noteEnd: p.noteEnd,
            similarity: p.similarity,
        });
        j = p.prevJ; i--;
    }
    return result;
}

// ---------- 按休止符分句 ----------
export function groupNotesByGap(notesWithTime) {
    const groups = [];
    let cur = [];
    for (let i = 0; i < notesWithTime.length; i++) {
        const n = notesWithTime[i];
        cur.push(n);
        if (i < notesWithTime.length - 1) {
            const nextStart = notesWithTime[i + 1].realStartTime;
            const curEnd = n.realStartTime + (n.realDuration || 0);
            if (nextStart - curEnd > GAP_FOR_LINE_BREAK_MS / 1000) {
                groups.push(cur);
                cur = [];
            }
        }
    }
    if (cur.length) groups.push(cur);
    return groups;
}
