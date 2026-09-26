import { initFileElements, handleFileSelect } from '../modules/file-handler.js';
import { setupRadioEvents } from '../components/radio-handler.js';
import { setupDropAreaEvents } from '../components/drop-area.js';

// 获取DOM元素
export let lyricsTextarea, svpInfoContent, lyricHint, timeError, generateBtn;

// 初始化页面
export function initPage() {
    // 初始化所有DOM元素
    initElements();
    
    // 初始化文件上传元素
    initFileElements();
    
    // 设置单选框事件
    setupRadioEvents();
    
    // 设置拖放区域事件
    setupDropAreaEvents();
    
    // 点击上传区域触发文件选择
    const fileUploadArea = document.getElementById('fileUploadArea');
    const svpFileInput = document.getElementById('svpFile');
    if (fileUploadArea && svpFileInput) {
        fileUploadArea.addEventListener('click', () => {
            svpFileInput.click();
        });
        
        // 原生文件选择事件
        svpFileInput.addEventListener('change', handleFileSelect);
    }

    // 绑定时间输入框的错误隐藏事件
    const timeMmInput = document.getElementById('timeMm');
    const timeSsInput = document.getElementById('timeSs');
    const timeMsInput = document.getElementById('timeMs');
    if (timeMmInput) timeMmInput.addEventListener('input', hideAllErrors);
    if (timeSsInput) timeSsInput.addEventListener('input', hideAllErrors);
    if (timeMsInput) timeMsInput.addEventListener('input', hideAllErrors);

    // 绑定生成按钮事件
    if (generateBtn) {
        import('../modules/lrc-generator.js').then((module) => {
            generateBtn.addEventListener('click', module.generateAndDownloadLrc);
        });
    }
}

// 初始化DOM元素
export function initElements() {
    lyricsTextarea = document.getElementById('lyrics') || null;
    svpInfoContent = document.getElementById('svpInfoContent') || null;
    lyricHint = document.getElementById('lyricHint') || null;
    timeError = document.getElementById('timeError') || null;
    generateBtn = document.getElementById('generateBtn') || null;
}

// 重置上传区域显示
export function resetUploadArea() {
    const uploadHintText = document.getElementById('uploadHintText');
    const uploadFileName = document.getElementById('uploadFileName');
    
    if (uploadHintText) uploadHintText.textContent = '点击选择或拖放SVP文件到此处';
    if (uploadFileName) uploadFileName.textContent = '';
}

// 隐藏所有错误提示
export function hideAllErrors() {
    const fileError = document.getElementById('fileError');
    
    if (fileError) fileError.style.display = 'none';
    if (timeError) timeError.style.display = 'none';
}

// 渲染SVP解析信息（显示变速）
export function renderSvpInfo(info) {
    if (!svpInfoContent) return; // 容错
    
    if (info.error) {
        svpInfoContent.innerHTML = `<div class="info-item" style="color: #f44336;">${info.error}</div>`;
        return;
    }
    const trackLine = info.trackSummary
        ? `<div class="info-item">
              <span class="info-label">音轨/音符组：</span>
              <span class="info-value">${info.trackSummary}</span>
           </div>`
        : '';
    svpInfoContent.innerHTML = `
        <div class="info-item">
            <span class="info-label">BPM信息：</span>
            <span class="info-value">${info.bpmInfo}</span>
        </div>
        <div class="info-item">
            <span class="info-label">拍号：</span>
            <span class="info-value">${info.meter}</span>
        </div>
        <div class="info-item">
            <span class="info-label">有效音符数：</span>
            <span class="info-value">${info.noteCount} 个</span>
        </div>
        <div class="info-item">
            <span class="info-label">总时长：</span>
            <span class="info-value">${info.totalDuration}</span>
        </div>
        <div class="info-item">
            <span class="info-label">音色库：</span>
            <span class="info-value">${info.voiceDatabase}</span>
        </div>
        <div class="info-item">
            <span class="info-label">采样率：</span>
            <span class="info-value">${info.sampleRate}</span>
        </div>
    `;
}
// ---------- 渲染轨道选择器（多轨/多音符组时） ----------
export function renderTrackSelector(trackList, selectedIndices, onSelectCallback) {
    const container = document.getElementById('trackSelectorContainer');
    if (!container) return;

    // 无内容 → 隐藏
    if (!trackList || trackList.length <= 1) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    container.innerHTML = `
        <div class="svp-info">
            <h3>选择要生成 LRC 的音符组（可多选）</h3>
            <div class="hint" style="color:#95a5a6;font-size:12px;margin-bottom:8px;">
                多选时按时间合并。一般只选一个主旋律即可。
            </div>
            <div class="track-list" id="trackListInner"></div>
        </div>
    `;
    const inner = document.getElementById('trackListInner');
    trackList.forEach((t, i) => {
        const div = document.createElement('div');
        div.className = 'track-item';
        div.dataset.index = String(i);
        if (selectedIndices.has(i)) div.classList.add('selected');
        div.innerHTML = `
            <div class="track-left">
                <div class="track-checkbox"></div>
                <div>
                    <div class="track-name">${escapeHtml(t.name)}</div>
                    <div class="track-path">${escapeHtml(t.path)}</div>
                </div>
            </div>
            <span class="track-count">${t.noteCount} 个音符</span>
        `;
        div.addEventListener('click', () => {
            const idx = parseInt(div.dataset.index, 10);
            if (selectedIndices.has(idx)) selectedIndices.delete(idx);
            else selectedIndices.add(idx);
            div.classList.toggle('selected');
            if (typeof onSelectCallback === 'function') {
                onSelectCallback(Array.from(selectedIndices));
            }
        });
        inner.appendChild(div);
    });
}

// ---------- 渲染匹配报告 ----------
export function renderMatchReport(details) {
    const container = document.getElementById('matchReportContainer');
    if (!container) return;

    if (!details || details.length === 0) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    const high = details.filter(d => d.similarity >= THRESHOLD_HIGH).length;
    const mid = details.filter(d => d.similarity >= THRESHOLD_MID && d.similarity < THRESHOLD_HIGH).length;
    const low = details.filter(d => d.similarity < THRESHOLD_MID).length;

    const summaryHtml =
        `<div class="report-summary">共 ${details.length} 行 · ` +
        `<span class="tag high">高 ≥${(THRESHOLD_HIGH*100).toFixed(0)}%：${high}</span>` +
        `<span class="tag mid">中 ${(THRESHOLD_MID*100).toFixed(0)}–${(THRESHOLD_HIGH*100).toFixed(0)}%：${mid}</span>` +
        `<span class="tag low">低 &lt;${(THRESHOLD_MID*100).toFixed(0)}%：${low}</span></div>`;

    const rowsHtml = details.map(d => {
        const cls = d.similarity >= THRESHOLD_HIGH ? 'high'
                  : d.similarity >= THRESHOLD_MID ? 'mid' : 'low';
        return `<div class="report-row ${cls}">
            <div class="report-line1">
                <span class="report-time">${escapeHtml(d.time)}</span>
                <span class="report-text">${escapeHtml(d.text)}</span>
                <span class="report-sim">${(d.similarity * 100).toFixed(0)}%</span>
            </div>
            <div class="report-compare">
                <div>歌词&nbsp;${escapeHtml(d.userNormalized)}</div>
                <div>SVP&nbsp;&nbsp;${escapeHtml(d.svpNormalized)}</div>
            </div>
        </div>`;
    }).join('');

    container.style.display = 'block';
    container.innerHTML = `
        <div class="svp-info">
            <h3>匹配报告（仅用于预览，不写入 LRC 文件）</h3>
            ${summaryHtml}
            <div class="report-list">${rowsHtml}</div>
        </div>
    `;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}
