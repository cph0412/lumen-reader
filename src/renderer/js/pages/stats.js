/**
 * Lumen · 流明阅读 — 足迹页面模块（#/stats）
 * 契约：export async function render(root, ctx)
 *
 * 数据：api.stats.overview / heatmap，api.vocab.list，api.lookup.history
 * 图表：内联 SVG（本周柱状图、目标圆环）+ CSS Grid 热力图，无任何外部资源。
 */

const FALLBACK_ICONS = {
  flame: '<path d="M12 3c3 4 5 5.5 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2.5-5 .5 1.5 1.5 2 2.5 2 0-2 0-4 0-6z"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 1.8"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
  chart: '<path d="M4 20h16"/><rect x="6" y="11" width="3" height="6" rx="1"/><rect x="11" y="7" width="3" height="10" rx="1"/><rect x="16" y="13" width="3" height="4" rx="1"/>',
  calendar: '<rect x="4" y="6" width="16" height="14" rx="2"/><path d="M4 10h16M9 4v4M15 4v4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
  sparkles: '<path d="m12 4 1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4z"/><path d="M18 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>',
  dot: '<circle cx="12" cy="12" r="3"/>'
};

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function icon(ctx, name, size = 18) {
  const fn = ctx && ctx.icons && ctx.icons[name];
  if (typeof fn === 'function') {
    try {
      const svg = fn(size);
      if (svg) return svg;
    } catch (err) { /* 降级 */ }
  }
  const path = FALLBACK_ICONS[name] || FALLBACK_ICONS.dot;
  return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
    '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
}

function escapeHtml(ctx, value) {
  if (ctx && typeof ctx.escapeHtml === 'function') {
    try { return ctx.escapeHtml(value == null ? '' : String(value)); } catch (err) { /* noop */ }
  }
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function formatNumber(ctx, value) {
  if (ctx && typeof ctx.fmtNumber === 'function') {
    try { return ctx.fmtNumber(value); } catch (err) { /* noop */ }
  }
  return String(value == null ? 0 : value);
}

function formatDate(ctx, iso, style) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  if (ctx && typeof ctx.formatDate === 'function') {
    try { return ctx.formatDate(iso, style); } catch (err) { /* noop */ }
  }
  return (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日';
}

function num(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  return Number.isFinite(Number(fallback)) ? Number(fallback) : 0;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function dateKey(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function heatLevel(minutes) {
  if (minutes <= 0) return 0;
  if (minutes < 10) return 1;
  if (minutes < 25) return 2;
  if (minutes < 50) return 3;
  return 4;
}

function formatDuration(totalMinutes) {
  const minutes = Math.max(0, Math.round(num(totalMinutes)));
  if (minutes < 60) return minutes + ' 分钟';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? hours + ' 小时 ' + rest + ' 分' : hours + ' 小时';
}

function relativeTime(iso, ctx) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / dayMs);
  const time = pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  if (diffDays <= 0) return '今天 ' + time;
  if (diffDays === 1) return '昨天 ' + time;
  if (diffDays < 7) return diffDays + ' 天前';
  return formatDate(ctx, date.toISOString(), 'short');
}

export async function render(root, ctx) {
  const api = ctx && ctx.api;
  const esc = (value) => escapeHtml(ctx, value);
  const toast = (message, tone) => {
    if (ctx && typeof ctx.toast === 'function') {
      try { ctx.toast(message, tone); return; } catch (err) { /* noop */ }
    }
  };
  const navigate = (route) => {
    if (ctx && typeof ctx.navigate === 'function') {
      try { ctx.navigate(route); } catch (err) { /* noop */ }
    }
  };

  const state = {
    overview: null,
    heatmap: [],
    vocabList: [],
    lookups: [],
    goal: 30,
    loading: true,
    reqId: 0
  };

  const settingsGoal = ctx && ctx.state && ctx.state.settings &&
    ctx.state.settings.general && Number(ctx.state.settings.general.dailyGoalMinutes);
  if (Number.isFinite(settingsGoal) && settingsGoal > 0) state.goal = settingsGoal;

  root.innerHTML = '<div class="stats-page page"></div>';
  const page = root.querySelector('.stats-page');

  /* ---- 骨架 / 错误 ------------------------------------------------------- */
  function renderSkeleton() {
    page.innerHTML =
      '<div class="stats-skeleton" aria-hidden="true">' +
        '<div class="stats-skeleton-row">' +
          '<div class="stats-skeleton-card"><span class="skeleton"></span><span class="skeleton is-num"></span><span class="skeleton"></span></div>' +
          '<div class="stats-skeleton-card"><span class="skeleton"></span><span class="skeleton is-num"></span><span class="skeleton"></span></div>' +
          '<div class="stats-skeleton-card"><span class="skeleton"></span><span class="skeleton is-num"></span><span class="skeleton"></span></div>' +
          '<div class="stats-skeleton-card"><span class="skeleton"></span><span class="skeleton is-num"></span><span class="skeleton"></span></div>' +
        '</div>' +
        '<div class="stats-skeleton-wide"><span class="skeleton is-title"></span><span class="skeleton is-block"></span></div>' +
        '<div class="stats-skeleton-wide"><span class="skeleton is-title"></span><span class="skeleton is-block"></span></div>' +
      '</div>';
  }

  function renderError(message) {
    page.innerHTML =
      '<header class="stats-head">' +
        '<div><p class="stats-eyebrow">Footprint</p><h1 class="stats-title">足迹</h1>' +
        '<p class="stats-lede">阅读、查询和复习留下的痕迹，都会在这里长成一张地图。</p></div>' +
      '</header>' +
      '<div class="stats-error">' +
        '<div class="stats-error__glyph">' + icon(ctx, 'refresh', 26) + '</div>' +
        '<h2 class="stats-error__title">足迹暂时走丢了</h2>' +
        '<p class="stats-error__body">' + esc(message || '无法读取统计数据，请稍后重试。') + '</p>' +
        '<button type="button" class="btn" id="stats-retry">' + icon(ctx, 'refresh', 16) + '<span>重新加载</span></button>' +
      '</div>';
    const retry = page.querySelector('#stats-retry');
    if (retry) retry.addEventListener('click', () => { load(); });
  }

  /* ---- 数据整理 ---------------------------------------------------------- */
  function normalizeOverview(raw, heatmapResult) {
    const ov = raw || {};
    const today = ov.today || {};
    const totals = ov.totals || {};
    const vocab = ov.vocab || {};
    const mastery = ov.mastery || {};
    const goalValue = num(ov.goal && ov.goal.minutes, state.goal) || 30;
    state.goal = goalValue;
    return {
      streak: num(ov.streak),
      daysRead: num(ov.daysRead),
      today: {
        minutes: num(today.minutes),
        words: num(today.words),
        lookups: num(today.lookups),
        reviews: num(today.reviews),
        added: num(today.added)
      },
      totals: {
        minutes: num(totals.minutes),
        words: num(totals.words),
        lookups: num(totals.lookups),
        reviews: num(totals.reviews)
      },
      weekly: Array.isArray(ov.weekly) ? ov.weekly : [],
      heatmap: Array.isArray(heatmapResult) && heatmapResult.length
        ? heatmapResult
        : (Array.isArray(ov.heatmap) ? ov.heatmap : []),
      vocab: {
        total: num(vocab.total),
        due: num(vocab.due),
        learning: num(vocab.learning),
        mastered: num(vocab.mastered),
        new: num(vocab.new)
      },
      mastery: {
        new: num(mastery.new),
        learning: num(mastery.learning),
        mastered: num(mastery.mastered)
      },
      goal: goalValue
    };
  }

  function buildWeekly() {
    const map = new Map();
    state.overview.heatmap.forEach((entry) => {
      if (entry && entry.date) map.set(entry.date, entry);
    });
    const weeklyMap = new Map();
    state.overview.weekly.forEach((entry) => {
      if (entry && entry.date) weeklyMap.set(entry.date, entry);
    });
    const today = startOfDay(new Date());
    const days = [];
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const key = dateKey(date);
      const source = weeklyMap.get(key) || map.get(key) || {};
      days.push({
        date: key,
        minutes: num(source.minutes),
        words: num(source.words),
        lookups: num(source.lookups),
        dow: date.getDay(),
        isToday: i === 0
      });
    }
    return days;
  }

  function buildHeatmap() {
    const map = new Map();
    state.overview.heatmap.forEach((entry) => {
      if (entry && entry.date) map.set(entry.date, entry);
    });
    const today = startOfDay(new Date());
    const dow = (today.getDay() + 6) % 7;
    const lastColumnStart = new Date(today);
    lastColumnStart.setDate(today.getDate() - dow);
    const first = new Date(lastColumnStart);
    first.setDate(lastColumnStart.getDate() - 11 * 7);

    let cells = '';
    let months = '';
    let lastMonth = -1;
    let totalMinutes = 0;
    let activeDays = 0;

    for (let week = 0; week < 12; week += 1) {
      const columnStart = new Date(first);
      columnStart.setDate(first.getDate() + week * 7);
      const month = columnStart.getMonth();
      months += '<span class="heat-month">' + (month !== lastMonth ? (month + 1) + ' 月' : '') + '</span>';
      lastMonth = month;

      for (let row = 0; row < 7; row += 1) {
        const date = new Date(columnStart);
        date.setDate(columnStart.getDate() + row);
        if (date.getTime() > today.getTime()) {
          cells += '<span class="heat-cell heat-cell--future"></span>';
          continue;
        }
        const key = dateKey(date);
        const entry = map.get(key) || {};
        const minutes = num(entry.minutes);
        const words = num(entry.words);
        const readableDate = (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日 ' + WEEKDAY_NAMES[date.getDay()];
        const label = readableDate + ' · ' + minutes + ' 分钟' + (words ? ' · ' + words + ' 词' : '');
        const level = heatLevel(minutes);
        totalMinutes += minutes;
        if (minutes > 0) activeDays += 1;
        cells += '<span class="heat-cell heat-cell--l' + level + '" data-tip-date="' + esc(key) + '" data-tip-title="' + esc(readableDate) + '" data-minutes="' + minutes + '" data-words="' + words + '" title="' + esc(label) + '"></span>';
      }
    }

    return { cells: cells, months: months, totalMinutes: totalMinutes, activeDays: activeDays };
  }

  function masteryCounts() {
    const counts = [0, 0, 0, 0, 0, 0];
    if (Array.isArray(state.vocabList) && state.vocabList.length) {
      state.vocabList.forEach((word) => {
        const value = Math.max(0, Math.min(5, Math.round(num(word && word.mastery))));
        counts[value] += 1;
      });
      return {
        counts: counts,
        groups: {
          new: counts[0],
          learning: counts[1] + counts[2] + counts[3],
          mastered: counts[4] + counts[5]
        },
        total: counts.reduce((sum, value) => sum + value, 0)
      };
    }
    const vocab = state.overview.vocab;
    const groups = {
      new: num(state.overview.mastery.new, vocab.new),
      learning: num(state.overview.mastery.learning, vocab.learning),
      mastered: num(state.overview.mastery.mastered, vocab.mastered)
    };
    return {
      counts: [groups.new, 0, 0, 0, groups.mastered, 0],
      groups: groups,
      total: groups.new + groups.learning + groups.mastered
    };
  }

  /* ---- 片段 -------------------------------------------------------------- */
  function heroHtml(overview) {
    const weekMinutes = weeklyMinutes();
    const mastery = masteryCounts();
    const masteryRate = mastery.total > 0 ? Math.round((mastery.groups.mastered / mastery.total) * 100) : 0;
    return '<section class="stats-hero" aria-label="阅读统计概览">' +
      bigStat('flame', 'accent', '连续阅读', overview.streak, '天', overview.daysRead > 0 ? '累计阅读 ' + formatNumber(ctx, overview.daysRead) + ' 天' : '从今天开始记录') +
      bigStat('clock', 'sage', '本周阅读', weekMinutes, '分钟', '今日已读 ' + formatNumber(ctx, overview.today.minutes) + ' 分钟') +
      bigStat('book', 'accent', '累计生词', overview.vocab.total, '个', '今日新增 ' + formatNumber(ctx, overview.today.added) + ' 个') +
      bigStat('target', 'sage', '已掌握', overview.vocab.mastered, '个', mastery.total > 0 ? '掌握率 ' + masteryRate + '%' : '复习几轮后会开始掌握') +
    '</section>';
  }

  function bigStat(iconName, tone, label, value, unit, sub) {
    return '<article class="stats-big">' +
      '<div class="stats-big__top">' +
        '<span class="stats-big__label">' + esc(label) + '</span>' +
        '<span class="stats-big__icon' + (tone === 'sage' ? ' stats-big__icon--sage' : '') + '">' + icon(ctx, iconName, 16) + '</span>' +
      '</div>' +
      '<span class="stats-big__value">' + formatNumber(ctx, value) + '<small>' + unit + '</small></span>' +
      '<span class="stats-big__sub">' + esc(sub) + '</span>' +
      '<span class="stats-big__spark"></span>' +
    '</article>';
  }

  function footnoteHtml(overview) {
    const parts = [
      '累计阅读 <b>' + formatDuration(overview.totals.minutes) + '</b>',
      '读过 <b>' + formatNumber(ctx, overview.totals.words) + '</b> 词',
      '查询 <b>' + formatNumber(ctx, overview.totals.lookups) + '</b> 次',
      '复习 <b>' + formatNumber(ctx, overview.totals.reviews) + '</b> 次'
    ];
    return '<div class="stats-footnote">' + parts.map((part) => '<span>' + part + '</span>').join('') + '</div>';
  }

  function weeklyMinutes() {
    return buildWeekly().reduce((sum, day) => sum + day.minutes, 0);
  }

  function weekChartHtml(overview) {
    const days = buildWeekly();
    const total = days.reduce((sum, day) => sum + day.minutes, 0);
    const activeDays = days.filter((day) => day.minutes > 0).length;
    const goal = overview.goal;

    const W = 640;
    const H = 234;
    const padX = 10;
    const plotW = W - padX * 2;
    const baseY = 186;
    const maxBarH = 148;
    const slot = plotW / 7;
    const barW = 34;
    const maxValue = Math.max(goal, days.reduce((max, day) => Math.max(max, day.minutes), 0), 1);
    const goalY = baseY - (Math.min(goal, maxValue) / maxValue) * maxBarH;

    let grid = '';
    [0.5, 1].forEach((ratio) => {
      const y = baseY - ratio * maxBarH;
      grid += '<line class="stats-grid-line" x1="' + padX + '" y1="' + y + '" x2="' + (W - padX) + '" y2="' + y + '"></line>';
    });

    let bars = '';
    let labels = '';
    days.forEach((day, index) => {
      const centerX = padX + slot * index + slot / 2;
      const barH = day.minutes > 0 ? Math.max(4, Math.round((day.minutes / maxValue) * maxBarH)) : 3;
      const y = baseY - barH;
      const x = centerX - barW / 2;
      const className = day.minutes > 0
        ? (day.isToday ? 'stats-bar stats-bar--today' : 'stats-bar')
        : 'stats-bar stats-bar--empty';
      bars += '<rect class="' + className + '" x="' + x + '" y="' + y + '" width="' + barW + '" height="' + barH + '" rx="4" ' +
        'data-tip-date="' + esc(day.date) + '" data-minutes="' + day.minutes + '" data-words="' + day.words + '" data-lookups="' + day.lookups + '" ' +
        'data-tip-title="' + esc(WEEKDAY_NAMES[day.dow] + ' · ' + day.date) + '">' +
        '<title>' + esc(day.date + ' · ' + day.minutes + ' 分钟') + '</title></rect>';
      if (day.minutes > 0) {
        bars += '<text class="stats-bar-value' + (day.isToday ? ' stats-bar-value--today' : '') + '" x="' + centerX + '" y="' + (y - 7) + '">' + day.minutes + '</text>';
      }
      labels += '<text class="stats-axis-label' + (day.isToday ? ' stats-axis-label--today' : '') + '" x="' + centerX + '" y="' + (baseY + 19) + '">' + WEEKDAY_NAMES[day.dow] + '</text>';
      labels += '<text class="stats-axis-date" x="' + centerX + '" y="' + (baseY + 33) + '">' + day.date.slice(5) + '</text>';
    });

    const svg = '<svg class="stats-chart-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="本周每日阅读分钟柱状图">' +
      grid +
      '<line class="stats-goal-line" x1="' + padX + '" y1="' + goalY + '" x2="' + (W - padX) + '" y2="' + goalY + '"></line>' +
      '<text class="stats-goal-text" x="' + (W - padX) + '" y="' + (goalY - 6) + '">目标 ' + goal + ' 分钟</text>' +
      bars +
      '<line class="stats-grid-line" x1="' + padX + '" y1="' + baseY + '" x2="' + (W - padX) + '" y2="' + baseY + '"></line>' +
      labels +
    '</svg>';

    return '<section class="stats-card stats-week" aria-label="本周阅读">' +
      '<div class="stats-card-head">' +
        '<div><h2 class="stats-card-title">本周阅读</h2><p class="stats-card-desc">按天累计的阅读分钟</p></div>' +
        '<span class="stats-card-aside">共 <b>' + formatNumber(ctx, total) + '</b> 分钟</span>' +
      '</div>' +
      '<div class="stats-week-chart">' + svg + '</div>' +
      '<div class="stats-week-foot">' +
        '<span>活跃 <b>' + activeDays + '</b> / 7 天' + (activeDays > 0 ? ' · 日均 <b>' + Math.round(total / 7) + '</b> 分钟' : '') + '</span>' +
        '<span>今日 <b>' + formatNumber(ctx, overview.today.minutes) + '</b> 分钟' + (overview.today.minutes > 0 ? ' · ' + formatNumber(ctx, overview.today.words) + ' 词' : '') + '</span>' +
      '</div>' +
    '</section>';
  }

  function heatmapHtml() {
    const heat = buildHeatmap();
    return '<section class="stats-card stats-heat" aria-label="阅读热力图">' +
      '<div class="stats-card-head">' +
        '<div><h2 class="stats-card-title">12 周活动</h2><p class="stats-card-desc">每天留下的阅读痕迹，颜色越深读得越久</p></div>' +
        '<div class="heat-legend" aria-hidden="true"><span>少</span><i></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>多</span></div>' +
      '</div>' +
      '<div class="heat-months">' + heat.months + '</div>' +
      '<div class="heat-body">' +
        '<div class="heat-weekdays" aria-hidden="true"><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span><span>日</span></div>' +
        '<div class="heat-cells">' + heat.cells + '</div>' +
      '</div>' +
      '<div class="stats-heat-foot">' +
        '<span>近 12 周共阅读 <b>' + formatDuration(heat.totalMinutes) + '</b> · 活跃 <b>' + heat.activeDays + '</b> 天</span>' +
        '<span>悬浮查看每天明细</span>' +
      '</div>' +
    '</section>';
  }

  function masteryHtml() {
    const mastery = masteryCounts();
    const groups = mastery.groups;
    const total = Math.max(mastery.total, 1);
    const newPct = Math.round((groups.new / total) * 100);
    const learningPct = Math.round((groups.learning / total) * 100);
    const masteredPct = Math.max(0, 100 - newPct - learningPct);

    const row = (label, tone, count, pct) =>
      '<div class="stats-mastery-row">' +
        '<span class="stats-mastery-label"><i class="l-' + tone + '"></i>' + label + '</span>' +
        '<span class="stats-mastery-track"><span class="stats-mastery-fill stats-mastery-fill--' + tone + '" style="width:' + pct + '%"></span></span>' +
        '<span class="stats-mastery-count"><b>' + formatNumber(ctx, count) + '</b> · ' + pct + '%</span>' +
      '</div>';

    return '<section class="stats-card" aria-label="掌握度分布">' +
      '<div class="stats-card-head">' +
        '<div><h2 class="stats-card-title">掌握度分布</h2><p class="stats-card-desc">生词本里的 ' + formatNumber(ctx, mastery.total) + ' 个词学到哪一步了</p></div>' +
      '</div>' +
      '<div class="stats-stack" role="img" aria-label="新词 ' + groups.new + '，学习中 ' + groups.learning + '，已掌握 ' + groups.mastered + '">' +
        '<span class="stats-stack__seg stats-stack__seg--new" style="width:' + newPct + '%"></span>' +
        '<span class="stats-stack__seg stats-stack__seg--learning" style="width:' + learningPct + '%"></span>' +
        '<span class="stats-stack__seg stats-stack__seg--mastered" style="width:' + masteredPct + '%"></span>' +
      '</div>' +
      '<div class="stats-mastery-rows">' +
        row('新词', 'new', groups.new, newPct) +
        row('学习中', 'learning', groups.learning, learningPct) +
        row('已掌握', 'mastered', groups.mastered, masteredPct) +
      '</div>' +
    '</section>';
  }

  function goalHtml(overview) {
    const goal = overview.goal || 30;
    const todayMinutes = overview.today.minutes;
    const percent = Math.min(100, Math.round((todayMinutes / Math.max(goal, 1)) * 100));
    const radius = 48;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percent / 100) * circumference;
    const done = todayMinutes >= goal;

    return '<section class="stats-card" aria-label="阅读目标">' +
      '<div class="stats-card-head">' +
        '<div><h2 class="stats-card-title">今日阅读目标</h2><p class="stats-card-desc">来自设置 · 每日目标 ' + formatNumber(ctx, goal) + ' 分钟</p></div>' +
      '</div>' +
      '<div class="stats-goal-body">' +
        '<div class="stats-ring" role="img" aria-label="今日目标完成 ' + percent + '%">' +
          '<svg viewBox="0 0 120 120" aria-hidden="true">' +
            '<circle class="stats-ring__track" cx="60" cy="60" r="' + radius + '" fill="none" stroke-width="7"></circle>' +
            '<circle class="stats-ring__fill" cx="60" cy="60" r="' + radius + '" fill="none" stroke-width="7" ' +
              'stroke-dasharray="' + circumference.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '"></circle>' +
          '</svg>' +
          '<span class="stats-ring__center"><span class="stats-ring__num">' + formatNumber(ctx, todayMinutes) + '</span><span class="stats-ring__unit">分钟</span></span>' +
        '</div>' +
        '<div class="stats-goal-info">' +
          (done
            ? '<span class="stats-goal-badge">' + icon(ctx, 'check', 12) + ' 今日目标已完成</span>'
            : '<span class="stats-goal-badge stats-goal-badge--pending">' + icon(ctx, 'sparkles', 12) + ' 还差 ' + formatNumber(ctx, Math.max(0, goal - todayMinutes)) + ' 分钟</span>') +
          '<p class="stats-goal-title">' + percent + '% 完成</p>' +
          '<p class="stats-goal-text">今天读了 <b>' + formatNumber(ctx, todayMinutes) + '</b> 分钟，' +
            '翻了 <b>' + formatNumber(ctx, overview.today.words) + '</b> 个词。</p>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  function lookupsHtml() {
    const history = Array.isArray(state.lookups) ? state.lookups.slice(0, 6) : [];
    if (!history.length) {
      return '<section class="stats-card" aria-label="最近查询">' +
        '<div class="stats-card-head"><div><h2 class="stats-card-title">最近查询</h2><p class="stats-card-desc">划词翻译留下的记录</p></div></div>' +
        '<div class="stats-mini-empty">' + icon(ctx, 'search', 22) +
          '<span>还没有查询记录<br><b>在阅读器里选中一段英文</b>，释义会在这里留下痕迹。</span>' +
        '</div>' +
      '</section>';
    }
    const rows = history.map((item) => {
      const text = item && (item.text || item.query || item.word) ? (item.text || item.query || item.word) : '—';
      const translation = item && item.translation ? item.translation : '暂无释义';
      const provider = item && item.provider ? String(item.provider) : 'lookup';
      return '<div class="stats-list-row">' +
        '<div class="stats-list-main">' +
          '<span class="stats-list-word" title="' + esc(text) + '">' + esc(text) + '</span>' +
          '<span class="stats-list-trans" title="' + esc(translation) + '">' + esc(translation) + '</span>' +
        '</div>' +
        '<span class="stats-list-badge">' + esc(provider) + '</span>' +
        '<span class="stats-list-meta">' + esc(relativeTime(item && item.createdAt, ctx)) + '</span>' +
      '</div>';
    }).join('');
    return '<section class="stats-card" aria-label="最近查询">' +
      '<div class="stats-card-head"><div><h2 class="stats-card-title">最近查询</h2><p class="stats-card-desc">划词翻译留下的记录</p></div>' +
        '<span class="stats-card-aside">累计 <b>' + formatNumber(ctx, state.overview.totals.lookups) + '</b> 次</span></div>' +
      '<div class="stats-list">' + rows + '</div>' +
      '<button type="button" class="btn ghost stats-list-more" data-go="vocab">去生词本</button>' +
    '</section>';
  }

  function recentVocabHtml() {
    const list = Array.isArray(state.vocabList) ? state.vocabList.slice(0, 6) : [];
    if (!list.length) {
      return '<section class="stats-card" aria-label="最近生词">' +
        '<div class="stats-card-head"><div><h2 class="stats-card-title">最近生词</h2><p class="stats-card-desc">收藏下来的词会出现在这里</p></div></div>' +
        '<div class="stats-mini-empty">' + icon(ctx, 'book', 22) +
          '<span>生词本还是空的<br><b>阅读时选中单词并收藏</b>，它们会在这里排队。</span>' +
        '</div>' +
      '</section>';
    }
    const rows = list.map((word) => {
      const value = Math.max(0, Math.min(5, Math.round(num(word && word.mastery))));
      let dots = '';
      for (let i = 1; i <= 5; i += 1) dots += '<i class="' + (i <= value ? 'is-on' : '') + '"></i>';
      return '<div class="stats-list-row stats-list-row--link" data-goto="vocab" role="button" tabindex="0">' +
        '<div class="stats-list-main">' +
          '<span class="stats-list-word">' + esc(word && word.word ? word.word : '—') + '</span>' +
          '<span class="stats-list-trans">' + esc(word && word.translation ? word.translation : '暂无释义') + '</span>' +
        '</div>' +
        '<span class="stats-mastery-dots" title="掌握度 ' + value + '/5">' + dots + '</span>' +
        '<span class="stats-list-meta">' + esc(relativeTime(word && word.createdAt, ctx)) + '</span>' +
      '</div>';
    }).join('');
    return '<section class="stats-card" aria-label="最近生词">' +
      '<div class="stats-card-head"><div><h2 class="stats-card-title">最近生词</h2><p class="stats-card-desc">生词本里的新面孔</p></div>' +
        '<span class="stats-card-aside">共 <b>' + formatNumber(ctx, state.overview.vocab.total) + '</b> 个</span></div>' +
      '<div class="stats-list">' + rows + '</div>' +
      '<button type="button" class="btn ghost stats-list-more" data-go="vocab">打开生词本</button>' +
    '</section>';
  }

  function bannerHtml(overview) {
    const noReading = overview.totals.minutes === 0 && overview.streak === 0;
    if (!noReading) return '';
    return '<div class="stats-banner">' +
      '<span class="stats-banner__icon">' + icon(ctx, 'book', 15) + '</span>' +
      '<span class="stats-banner__text"><b>还没有阅读记录。</b> 打开一本书读上十分钟，这里就会亮起来。</span>' +
      '<button type="button" class="btn primary" id="stats-go-library">去书库</button>' +
    '</div>';
  }

  function headHtml(overview) {
    const goal = overview.goal || state.goal;
    return '<header class="stats-head">' +
      '<div>' +
        '<p class="stats-eyebrow">Footprint</p>' +
        '<h1 class="stats-title">足迹</h1>' +
        '<p class="stats-lede">阅读、查询和复习留下的痕迹，都会在这里长成一张地图。</p>' +
      '</div>' +
      '<div class="stats-head-meta">' +
        '<span class="stats-goal-pill">' + icon(ctx, 'target', 15) + '今日目标 <b>' + formatNumber(ctx, goal) + '</b> 分钟</span>' +
        '<span class="stats-goal-pill">' + icon(ctx, 'flame', 15) + '连续 <b>' + formatNumber(ctx, overview.streak) + '</b> 天</span>' +
      '</div>' +
    '</header>';
  }

  /* ---- 工具提示 ---------------------------------------------------------- */
  function bindTooltips() {
    const tip = page.querySelector('#stats-tip');
    if (!tip) return;

    function show(target, clientX, clientY) {
      const minutes = num(target.getAttribute('data-minutes'));
      const words = num(target.getAttribute('data-words'));
      const lookups = num(target.getAttribute('data-lookups'));
      const title = target.getAttribute('data-tip-title') || target.getAttribute('data-tip-date') || '';
      tip.replaceChildren();
      const heading = document.createElement('b');
      heading.textContent = title;
      tip.appendChild(heading);
      const detail = document.createElement('span');
      detail.textContent = '阅读 ' + minutes + ' 分钟' +
        (words ? ' · ' + words + ' 词' : '') +
        (lookups ? ' · ' + lookups + ' 次查询' : '');
      tip.appendChild(detail);
      tip.style.left = clientX + 'px';
      tip.style.top = clientY + 'px';
      tip.classList.add('is-on');
    }

    function hide() {
      tip.classList.remove('is-on');
    }

    page.addEventListener('mousemove', (event) => {
      const target = event.target.closest ? event.target.closest('[data-tip-date]') : null;
      if (!target) { hide(); return; }
      const rect = target.getBoundingClientRect();
      show(target, rect.left + rect.width / 2, rect.top - 3);
    });
    page.addEventListener('mouseleave', hide);
    if (typeof window !== 'undefined') {
      window.addEventListener('scroll', hide, { passive: true });
    }
  }

  /* ---- 绘制 -------------------------------------------------------------- */
  function paint() {
    const overview = state.overview;
    page.innerHTML =
      headHtml(overview) +
      bannerHtml(overview) +
      heroHtml(overview) +
      footnoteHtml(overview) +
      weekChartHtml(overview) +
      heatmapHtml() +
      '<div class="stats-two">' + masteryHtml() + goalHtml(overview) + '</div>' +
      '<div class="stats-two">' + lookupsHtml() + recentVocabHtml() + '</div>' +
      '<div class="stats-tip" id="stats-tip" role="status" aria-hidden="true"></div>';

    const libraryButton = page.querySelector('#stats-go-library');
    if (libraryButton) libraryButton.addEventListener('click', () => navigate('library'));

    page.querySelectorAll('[data-goto="vocab"]').forEach((row) => {
      const go = () => navigate('vocab');
      row.addEventListener('click', go);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          go();
        }
      });
    });

    page.querySelectorAll('[data-go="vocab"]').forEach((button) => {
      button.addEventListener('click', () => navigate('vocab'));
    });

    bindTooltips();
  }

  /* ---- 加载 -------------------------------------------------------------- */
  async function load() {
    if (!api || !api.stats || typeof api.stats.overview !== 'function') {
      renderError('无法连接到统计服务。请确认通过 Lumen 桌面应用打开，或稍后重试。');
      return;
    }
    const reqId = ++state.reqId;
    state.loading = true;
    renderSkeleton();

    try {
      const [overviewResult, heatmapResult, vocabResult, historyResult] = await Promise.all([
        api.stats.overview(),
        api.stats && typeof api.stats.heatmap === 'function'
          ? api.stats.heatmap(120).catch(() => null)
          : Promise.resolve(null),
        api.vocab && typeof api.vocab.list === 'function'
          ? api.vocab.list().catch(() => [])
          : Promise.resolve([]),
        api.lookup && typeof api.lookup.history === 'function'
          ? api.lookup.history(8).catch(() => [])
          : Promise.resolve([])
      ]);
      if (reqId !== state.reqId) return;

      state.overview = normalizeOverview(overviewResult, heatmapResult);
      state.heatmap = state.overview.heatmap;
      state.vocabList = Array.isArray(vocabResult) ? vocabResult : [];
      state.lookups = Array.isArray(historyResult) ? historyResult : [];
      state.loading = false;
      paint();
    } catch (err) {
      if (reqId !== state.reqId) return;
      state.loading = false;
      renderError(err && err.message ? err.message : '读取统计失败');
    }
  }

  await load();
}
