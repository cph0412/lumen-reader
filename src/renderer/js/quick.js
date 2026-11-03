/**
 * Lumen · 流明阅读 — 划词浮窗脚本（quick.html，420×560 透明窗口）
 *
 * 数据：window.lumen.lookup.quick / analyze / dictionary，vocab.add，settings.get，quick.hide，app.openMain
 * 事件：window.lumen.events.onQuickLookup({text, source, error}) / onTheme
 * 兜底：首次加载读取 window.__QUICK_TEXT__ 或 URL 查询参数 ?text=
 */

(function () {
  'use strict';

  const api = typeof window !== 'undefined' && window.lumen ? window.lumen : null;

  const ICONS = {
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    speaker: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18.5 7a7 7 0 0 1 0 10"/>',
    bookmark: '<path d="M7 4h10v16l-5-3.5L7 20V4z"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5"/>',
    sparkles: '<path d="m12 4 1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4z"/><path d="M18 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z"/>',
    check: '<path d="m5 13 4 4L19 7"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>',
    info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
    dot: '<circle cx="12" cy="12" r="3"/>'
  };

  const PROVIDER_LABELS = {
    'google-free': 'Google 翻译',
    'mymemory': 'MyMemory',
    'ai': 'AI 翻译',
    'dictionary': '词典',
    'cache': '缓存'
  };

  const KIND_LABELS = {
    word: '单词',
    phrase: '短语',
    sentence: '句子',
    paragraph: '段落'
  };

  const state = {
    text: '',
    source: '',
    result: null,
    analysis: null,
    saved: false,
    busy: false,
    loading: false,
    expanded: false,
    settings: null
  };

  const els = {};
  const cleanups = [];
  let lookupToken = 0;
  let noteTimer = null;

  function icon(name, size) {
    const path = ICONS[name] || ICONS.dot;
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
      '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  function cacheElements() {
    els.text = document.getElementById('q-text');
    els.source = document.getElementById('q-source');
    els.body = document.getElementById('q-body');
    els.speak = document.getElementById('q-speak');
    els.expand = document.getElementById('q-expand');
    els.save = document.getElementById('q-save');
    els.saveIcon = document.getElementById('q-save-icon');
    els.saveLabel = document.getElementById('q-save-label');
    els.saveNote = document.getElementById('q-save-note');
    els.open = document.getElementById('q-open');
    els.close = document.getElementById('q-close');
    els.hide = document.getElementById('q-hide');
  }

  /* ---- 窗口控制 ---------------------------------------------------------- */
  async function hideWindow() {
    try {
      if (api && api.quick && typeof api.quick.hide === 'function') {
        await api.quick.hide();
        return;
      }
    } catch (err) { /* fall through */ }
    try {
      window.close();
    } catch (err) { /* noop */ }
  }

  async function openMain() {
    try {
      if (api && api.app && typeof api.app.openMain === 'function') {
        await api.app.openMain();
        await hideWindow();
        return;
      }
    } catch (err) { /* fall through */ }
    await hideWindow();
  }

  /* ---- 文案映射 ---------------------------------------------------------- */
  function friendlyError(err) {
    const code = err && err.code;
    if (code === 'NO_AI_KEY') return '还没有配置 API Key';
    if (code === 'NETWORK') return '网络不可用，请检查连接';
    if (code === 'NOT_FOUND') return '没有找到这个单词';
    if (code === 'INVALID_FILE') return '文件格式不正确';
    return err && err.message ? String(err.message) : '请求失败，请稍后重试';
  }

  function providerLabel(provider) {
    return PROVIDER_LABELS[provider] || provider || '翻译';
  }

  function kindLabel(kind) {
    return KIND_LABELS[kind] || '';
  }

  function setSaveNote(message, isError) {
    if (!els.saveNote) return;
    if (noteTimer) window.clearTimeout(noteTimer);
    els.saveNote.textContent = message || '';
    els.saveNote.className = 'quick-save-note' + (isError ? ' is-error' : '');
    if (message && !isError) {
      noteTimer = window.setTimeout(() => {
        if (els.saveNote) els.saveNote.textContent = '';
      }, 4200);
    }
  }

  /* ---- 捕获文本区 -------------------------------------------------------- */
  function updateExpandButton() {
    if (!els.text || !els.expand) return;
    if (!state.text) {
      els.expand.hidden = true;
      return;
    }
    if (state.expanded) {
      els.expand.hidden = false;
      els.expand.textContent = '收起';
      return;
    }
    window.requestAnimationFrame(() => {
      try {
        const overflows = els.text.scrollHeight > els.text.clientHeight + 2;
        els.expand.hidden = !overflows;
        els.expand.textContent = '展开';
      } catch (err) {
        els.expand.hidden = true;
      }
    });
  }

  function toggleExpanded() {
    if (!els.text) return;
    state.expanded = !state.expanded;
    els.text.classList.toggle('is-expanded', state.expanded);
    updateExpandButton();
  }

  function showPlaceholder() {
    state.text = '';
    state.result = null;
    state.analysis = null;
    state.saved = false;
    state.busy = false;
    setSaveNote('');
    if (els.text) {
      els.text.textContent = '还没有捕获到文本';
      els.text.classList.add('is-placeholder');
      els.text.classList.remove('is-expanded');
    }
    if (els.source) {
      els.source.hidden = true;
      els.source.textContent = '';
    }
    if (els.expand) els.expand.hidden = true;
    state.expanded = false;
    updateSaveButton();
  }

  function setText(rawText, meta) {
    const info = meta || {};
    const text = String(rawText || '').trim();
    state.source = info.source || '';

    if (!text) {
      showPlaceholder();
      if (info.error) {
        renderError('没有拿到选中的文本：' + info.error);
      } else {
        renderEmpty();
      }
      return;
    }

    state.text = text;
    state.result = null;
    state.analysis = null;
    state.saved = false;
    state.busy = false;
    state.expanded = false;

    if (els.text) {
      els.text.textContent = text;
      els.text.classList.remove('is-placeholder', 'is-expanded');
    }

    if (els.source) {
      if (info.source === 'clipboard') {
        els.source.hidden = false;
        els.source.textContent = '来自剪贴板';
      } else if (info.source === 'selection') {
        els.source.hidden = false;
        els.source.textContent = '来自当前选中文本';
      } else {
        els.source.hidden = true;
        els.source.textContent = '';
      }
    }

    setSaveNote('');
    updateExpandButton();
    updateSaveButton();
    runLookup(text);
  }

  /* ---- 状态渲染 ---------------------------------------------------------- */
  function skeletonHtml() {
    return '<div class="quick-skeleton" aria-hidden="true">' +
      '<span class="skeleton is-title"></span>' +
      '<span class="skeleton is-trans"></span>' +
      '<span class="skeleton is-mid"></span>' +
      '<span class="skeleton is-block"></span>' +
    '</div>';
  }

  function aiSkeletonHtml() {
    return '<div class="quick-ai-head">' + icon('sparkles', 12) + 'AI 语境解析</div>' +
      '<div class="quick-skeleton quick-skeleton-ai" aria-hidden="true">' +
        '<span class="skeleton is-mid"></span>' +
        '<span class="skeleton"></span>' +
        '<span class="skeleton is-mid"></span>' +
      '</div>';
  }

  function renderSkeleton() {
    if (!els.body) return;
    els.body.innerHTML = skeletonHtml();
  }

  function renderEmpty() {
    if (!els.body) return;
    els.body.innerHTML = '<div class="quick-empty">' +
      '<div class="quick-empty__glyph">' + icon('search', 24) + '</div>' +
      '<p class="quick-empty__title">在任意应用中选中英文</p>' +
      '<p class="quick-empty__hint">然后按下 <kbd class="kbd">Alt</kbd> + <kbd class="kbd">Shift</kbd> + <kbd class="kbd">D</kbd>，这里会立刻给出翻译与语境解析。</p>' +
    '</div>';
  }

  function renderError(message) {
    if (!els.body) return;
    els.body.innerHTML = '<div class="quick-error">' +
      '<div class="quick-error__glyph">' + icon('info', 20) + '</div>' +
      '<p class="quick-error__title">这次没有查成</p>' +
      '<p class="quick-error__body">' + escapeHtml(message || '翻译服务暂时不可用，请稍后重试。') + '</p>' +
      '<button type="button" class="quick-retry" id="q-retry">' + icon('refresh', 11) + ' 重试</button>' +
    '</div>';
    const retry = document.getElementById('q-retry');
    if (retry) retry.addEventListener('click', () => {
      if (state.text) runLookup(state.text);
    });
  }

  function renderAiNotice(message) {
    const box = document.getElementById('quick-ai');
    if (!box) return;
    box.innerHTML = '<div class="quick-ai-head">' + icon('sparkles', 12) + 'AI 语境解析</div>' +
      '<p class="quick-note">' + icon('info', 12) + '<span>' + escapeHtml(message) + '</span></p>';
  }

  function renderAiManual() {
    const box = document.getElementById('quick-ai');
    if (!box) return;
    box.innerHTML = '<div class="quick-ai-head">' + icon('sparkles', 12) + 'AI 语境解析' +
      '<span class="quick-ai-mode">手动</span></div>' +
      '<div class="quick-ai-manual">' +
        '<p>自动解析已关闭。需要时点击「解析」，不会在每次划词时消耗 AI 额度。</p>' +
        '<button type="button" class="quick-ai-run" id="q-ai-run">' + icon('sparkles', 12) + ' 解析</button>' +
      '</div>';
    const run = document.getElementById('q-ai-run');
    if (run) {
      run.addEventListener('click', () => {
        const token = lookupToken;
        box.innerHTML = aiSkeletonHtml();
        loadAnalysis(state.text, token, true);
      });
    }
  }

  function dictHtml(dictionary) {
    if (!dictionary || !Array.isArray(dictionary.meanings) || !dictionary.meanings.length) return '';
    const meanings = dictionary.meanings.slice(0, 3).map((meaning) => {
      const partOfSpeech = meaning && meaning.partOfSpeech ? meaning.partOfSpeech : '·';
      const definition = meaning && (meaning.definitionZh || meaning.definition)
        ? (meaning.definitionZh || meaning.definition)
        : '';
      const example = meaning && meaning.example
        ? '<span class="quick-dict-example">' + escapeHtml(meaning.example) + '</span>'
        : '';
      return '<div class="quick-dict-item">' +
        '<span class="quick-dict-pos">' + escapeHtml(partOfSpeech) + '</span>' +
        '<div class="quick-dict-body"><span>' + escapeHtml(definition) + '</span>' + example + '</div>' +
      '</div>';
    }).join('');
    return '<div class="quick-dict">' + meanings + '</div>';
  }

  function renderResult(result) {
    if (!els.body) return;
    if (!result) {
      renderError('翻译结果为空，请重试。');
      return;
    }
    const dictionary = result.dictionary || null;
    const error = result.error || null;
    const phonetic = dictionary && dictionary.phonetic ? dictionary.phonetic : '';
    const translation = result.translation || '';

    let html = '<section class="quick-entry">';
    if (phonetic) html += '<span class="quick-phon">' + escapeHtml(phonetic) + '</span>';
    html += '<p class="quick-trans">' + escapeHtml(translation || '暂无翻译') + '</p>';

    const chips = [];
    if (result.kind && kindLabel(result.kind)) {
      chips.push('<span class="quick-chip">' + escapeHtml(kindLabel(result.kind)) + '</span>');
    }
    if (result.provider) {
      chips.push('<span class="quick-chip quick-chip--accent">' + escapeHtml(providerLabel(result.provider)) + '</span>');
    }
    if (chips.length) html += '<div class="quick-meta-row">' + chips.join('') + '</div>';
    html += '</section>';

    if (error) {
      html += '<p class="quick-note quick-note--error">' + icon('info', 12) +
        '<span>' + escapeHtml(error.message || '翻译服务暂时不可用') + '</span></p>' +
        '<button type="button" class="quick-retry" id="q-retry">' + icon('refresh', 11) + ' 重试</button>';
    }

    html += dictHtml(dictionary);
    html += '<div class="quick-ai" id="quick-ai">' + aiSkeletonHtml() + '</div>';

    els.body.innerHTML = html;

    const retry = document.getElementById('q-retry');
    if (retry) {
      retry.addEventListener('click', () => {
        if (state.text) runLookup(state.text);
      });
    }
  }

  function renderAnalysis(analysis) {
    const box = document.getElementById('quick-ai');
    if (!box) return;
    if (!analysis) {
      renderAiNotice('AI 没有返回可读的解析。');
      return;
    }

    const blocks = [];
    if (analysis.sense) blocks.push(analysisBlock('语境含义', analysis.sense));
    if (analysis.grammar) blocks.push(analysisBlock('语法结构', analysis.grammar));
    if (analysis.nuance) blocks.push(analysisBlock('细微差别', analysis.nuance));

    let html = '<div class="quick-ai-head">' + icon('sparkles', 12) + 'AI 语境解析</div>';
    if (analysis.level) {
      html += '<div class="quick-meta-row"><span class="quick-chip">CEFR ' + escapeHtml(analysis.level) + '</span></div>';
    }
    html += blocks.join('');

    if (Array.isArray(analysis.collocations) && analysis.collocations.length) {
      html += '<div class="quick-colloc">' +
        analysis.collocations.slice(0, 6).map((item) => '<span>' + escapeHtml(item) + '</span>').join('') +
      '</div>';
    }

    if (Array.isArray(analysis.examples) && analysis.examples.length) {
      const example = analysis.examples[0];
      if (example && (example.en || example.zh)) {
        html += '<p class="quick-example">' + escapeHtml(example.en || '') +
          (example.zh ? '<br>' + escapeHtml(example.zh) : '') + '</p>';
      }
    }

    if (!blocks.length && !(analysis.collocations && analysis.collocations.length) &&
      !(analysis.examples && analysis.examples.length)) {
      html += '<p class="quick-note">' + icon('info', 12) + '<span>AI 没有返回可读的解析。</span></p>';
    }

    box.innerHTML = html;
  }

  function analysisBlock(label, text) {
    return '<div class="quick-ai-block">' +
      '<span class="quick-ai-label">' + escapeHtml(label) + '</span>' +
      '<p>' + escapeHtml(text) + '</p>' +
    '</div>';
  }

  /* ---- 请求 -------------------------------------------------------------- */
  async function loadAnalysis(text, token, force) {
    if (!api || !api.lookup || typeof api.lookup.analyze !== 'function') return;
    const box = document.getElementById('quick-ai');
    if (!box) return;

    let settings = state.settings;
    if (api.settings && typeof api.settings.get === 'function') {
      try {
        settings = await api.settings.get();
        state.settings = settings;
      } catch (err) { /* 使用缓存 */ }
    }
    if (token !== lookupToken) return;

    if (!force && settings && settings.reader && settings.reader.autoAnalyze === false) {
      renderAiManual();
      return;
    }

    const ai = settings && settings.ai ? settings.ai : {};
    const baseUrl = String(ai.baseUrl || '').toLowerCase();
    const localUrl = baseUrl.indexOf('localhost') >= 0 || baseUrl.indexOf('127.0.0.1') >= 0;
    const hasKey = Boolean(ai.hasApiKey || ai.available || ai.local || localUrl);
    if (!hasKey) {
      renderAiNotice('在设置里填入 API Key，或把 Base URL 指向本地模型（如 Ollama），就能看到语境解析。');
      return;
    }

    try {
      const analysis = await api.lookup.analyze({ text: text });
      if (token !== lookupToken) return;
      state.analysis = analysis || null;
      renderAnalysis(analysis);
    } catch (err) {
      if (token !== lookupToken) return;
      const code = err && err.code;
      if (code === 'NO_AI_KEY') {
        renderAiNotice('API Key 无效或已过期，请在设置中检查。');
      } else {
        renderAiNotice('AI 解析暂不可用：' + friendlyError(err));
      }
    }
  }

  async function runLookup(text) {
    if (!api || !api.lookup || typeof api.lookup.quick !== 'function') {
      renderError('无法连接到翻译服务。请从 Lumen 主程序打开浮窗后重试。');
      updateSaveButton();
      return;
    }
    const token = ++lookupToken;
    state.loading = true;
    renderSkeleton();

    let result = null;
    try {
      result = await api.lookup.quick({ text: text });
    } catch (err) {
      if (token !== lookupToken) return;
      state.loading = false;
      state.result = null;
      renderError(friendlyError(err));
      updateSaveButton();
      return;
    }
    if (token !== lookupToken) return;

    state.loading = false;
    state.result = result || null;
    renderResult(result);
    updateSaveButton();
    loadAnalysis(text, token);

    if (result && result.kind === 'word' && !result.dictionary && api && api.lookup && typeof api.lookup.dictionary === 'function') {
      const word = String(result.normalized || result.text || text || '').trim();
      api.lookup.dictionary(word).then((dictionary) => {
        if (token !== lookupToken || !dictionary || !state.result) return;
        state.result.dictionary = dictionary;
        renderResult(state.result);
        updateSaveButton();
      }).catch(() => {});
    }
  }

  /* ---- 收藏 -------------------------------------------------------------- */
  function updateSaveButton() {
    if (!els.save) return;
    const canSave = Boolean(state.result) && !state.saved && !state.busy;
    els.save.disabled = !canSave;
    if (els.saveLabel) els.saveLabel.textContent = state.saved ? '已收藏' : '收藏生词';
    if (els.saveIcon) els.saveIcon.innerHTML = icon(state.saved ? 'check' : 'bookmark', 13);
  }

  async function saveWord() {
    if (state.saved || state.busy) return;
    if (!state.result) {
      setSaveNote('还没有可保存的释义', true);
      return;
    }
    if (!api || !api.vocab || typeof api.vocab.add !== 'function') {
      setSaveNote('当前环境不支持保存生词', true);
      return;
    }

    state.busy = true;
    updateSaveButton();

    const dictionary = state.result.dictionary || null;
    const payload = {
      word: state.text,
      translation: state.result.translation || '',
      context: state.text,
      tags: [],
      lookup: {
        provider: state.result.provider || 'unknown',
        kind: state.result.kind || 'word'
      }
    };
    if (dictionary && dictionary.phonetic) payload.phonetic = dictionary.phonetic;

    try {
      const outcome = await api.vocab.add(payload);
      state.busy = false;
      state.saved = true;
      setSaveNote(outcome && outcome.duplicate ? '这个单词已经在生词本里了' : '已收藏到生词本');
      updateSaveButton();
    } catch (err) {
      state.busy = false;
      setSaveNote('保存失败：' + friendlyError(err), true);
      updateSaveButton();
    }
  }

  /* ---- 朗读 -------------------------------------------------------------- */
  function speakCurrent() {
    const text = state.text;
    if (!text) {
      setSaveNote('没有可朗读的文本', true);
      return;
    }
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSaveNote('当前环境不支持语音朗读', true);
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;
      const voices = window.speechSynthesis.getVoices() || [];
      const preferred =
        voices.find((voice) => /en-US/i.test(voice.lang) && /(samantha|aria|jenny|zira|female|natural)/i.test(voice.name)) ||
        voices.find((voice) => /en-US/i.test(voice.lang)) ||
        voices.find((voice) => /^en/i.test(voice.lang));
      if (preferred) utterance.voice = preferred;
      if (els.speak) {
        els.speak.classList.add('is-speaking');
        utterance.onend = () => { if (els.speak) els.speak.classList.remove('is-speaking'); };
        utterance.onerror = () => { if (els.speak) els.speak.classList.remove('is-speaking'); };
      }
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      if (els.speak) els.speak.classList.remove('is-speaking');
      setSaveNote('朗读失败', true);
    }
  }

  /* ---- 初始化 ------------------------------------------------------------ */
  function consumeInitialText() {
    let text = '';
    try {
      if (typeof window.__QUICK_TEXT__ === 'string') text = window.__QUICK_TEXT__;
    } catch (err) { /* noop */ }
    if (!text) {
      try {
        const params = new URLSearchParams(window.location.search);
        text = params.get('text') || params.get('q') || '';
      } catch (err) { /* noop */ }
    }
    return String(text || '').trim();
  }

  async function syncTheme() {
    if (!api || !api.settings || typeof api.settings.get !== 'function') return;
    try {
      const settings = await api.settings.get();
      state.settings = settings || null;
      if (settings && settings.reader && settings.reader.theme) {
        document.documentElement.dataset.theme = settings.reader.theme;
      }
    } catch (err) { /* 保持默认主题 */ }
  }

  function setupEvents() {
    if (!api || !api.events) return;
    if (typeof api.events.onQuickLookup === 'function') {
      try {
        const off = api.events.onQuickLookup((data) => {
          const payload = data || {};
          if (payload.text) {
            setText(payload.text, payload);
          } else if (payload.error) {
            showPlaceholder();
            renderError('没有拿到选中的文本：' + payload.error);
          } else {
            showPlaceholder();
            renderEmpty();
          }
        });
        if (typeof off === 'function') cleanups.push(off);
      } catch (err) { /* noop */ }
    }
    if (typeof api.events.onTheme === 'function') {
      try {
        const off = api.events.onTheme((theme) => {
          if (theme) document.documentElement.dataset.theme = theme;
        });
        if (typeof off === 'function') cleanups.push(off);
      } catch (err) { /* noop */ }
    }
  }

  function bindUi() {
    if (els.close) els.close.addEventListener('click', hideWindow);
    if (els.hide) els.hide.addEventListener('click', hideWindow);
    if (els.open) els.open.addEventListener('click', openMain);
    if (els.speak) els.speak.addEventListener('click', speakCurrent);
    if (els.expand) els.expand.addEventListener('click', toggleExpanded);
    if (els.save) els.save.addEventListener('click', saveWord);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        hideWindow();
      }
    });

    window.addEventListener('beforeunload', () => {
      cleanups.forEach((fn) => {
        try { fn(); } catch (err) { /* noop */ }
      });
    });
  }

  async function init() {
    cacheElements();
    bindUi();
    setupEvents();

    const initialText = consumeInitialText();
    if (initialText) {
      setText(initialText, { source: 'selection' });
    } else {
      showPlaceholder();
      renderEmpty();
    }

    await syncTheme();
    updateExpandButton();
    updateSaveButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
