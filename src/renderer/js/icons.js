// Lumen · 统一内联 SVG 图标库
// 24 网格 / 1.6 stroke / currentColor。icons[name](size) 返回 SVG 字符串；未知名字返回 ''。
const P = {
  library: '<path d="M4 5.5h3.6v13H4z"/><path d="M9.1 5.5h3.6v13H9.1z"/><path d="M14.7 6.3l3.1-.85 3.1 12.25-3.1.85z"/>',
  book: '<path d="M5 4.5h9a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z"/><path d="M5 17.5a2 2 0 0 1 2-2h9"/>',
  bookOpen: '<path d="M12 6.5C10.5 5 8.5 4.5 4.5 4.5v13c4 0 6 .5 7.5 2 1.5-1.5 3.5-2 7.5-2v-13c-4 0-6 .5-7.5 2z"/><path d="M12 6.5v13"/>',
  bookmark: '<path d="M6.5 4.5h11v15l-5.5-3.6-5.5 3.6z"/>',
  bookmarkFilled: '<path d="M6.5 4.5h11v15l-5.5-3.6-5.5 3.6z" fill="currentColor"/>',
  layers: '<path d="M12 4l8 4.2-8 4.2-8-4.2z"/><path d="M4 12.4l8 4.2 8-4.2"/><path d="M4 16.6l8 4.2 8-4.2"/>',
  chart: '<path d="M4 20h16"/><path d="M7 20v-6"/><path d="M12 20V8"/><path d="M17 20v-9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6.1 6.1l1.4 1.4M16.5 16.5l1.4 1.4M17.9 6.1l-1.4 1.4M7.5 16.5l-1.4 1.4"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  import: '<path d="M12 4v10"/><path d="M8.2 10.2L12 14l3.8-3.8"/><path d="M5 16v3.5h14V16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8.2 8.2 0 1 0 10.5 10.5z"/>',
  chevronLeft: '<path d="M14.5 6L8.5 12l6 6"/>',
  chevronRight: '<path d="M9.5 6l6 6-6 6"/>',
  chevronDown: '<path d="M6 9.5l6 6 6-6"/>',
  volume: '<path d="M5 9.5h3l4-3.5v12l-4-3.5H5z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  sparkles: '<path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z"/><path d="M18.5 15.4l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 6V5A1.5 1.5 0 0 0 14 3.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h1"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.8h5V7"/><path d="M6.6 7l.85 12.1a1.5 1.5 0 0 0 1.5 1.4h6.1a1.5 1.5 0 0 0 1.5-1.4L17.4 7"/><path d="M10 11v5M14 11v5"/>',
  filter: '<path d="M4 6h16l-6 7v5l-4 2v-7z"/>',
  arrowRight: '<path d="M4.5 12h15"/><path d="M13.5 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19.5 12h-15"/><path d="M10.5 6l-6 6 6 6"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  flame: '<path d="M12 3.5c3 3.5 5.5 6.2 5.5 9.5a5.5 5.5 0 0 1-11 0c0-2 .9-3.6 2-5 .3 1.5 1 2.4 2 2.9.3-2.9.8-5.3 1.5-7.4z"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/>',
  download: '<path d="M12 4v10"/><path d="M8.2 10.2L12 14l3.8-3.8"/><path d="M4.5 19.5h15"/>',
  upload: '<path d="M12 15V5"/><path d="M8.2 8.2L12 4.4l3.8 3.8"/><path d="M4.5 19.5h15"/>',
  key: '<circle cx="8" cy="8" r="3.6"/><path d="M10.6 10.6L20 20"/><path d="M15.6 15.6l1.8-1.8M18.2 18.2l1.8-1.8"/>',
  external: '<path d="M14 4.5h5.5V10"/><path d="M19 5l-8 8"/><path d="M18 13.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5A1.5 1.5 0 0 1 5 6h5.5"/>',
  keyboard: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><path d="M7 10h.01M10.5 10h.01M14 10h.01M17.5 10h.01M7.5 13.5h9"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5"/><path d="M12 7.6h.01"/>',
  play: '<path d="M7.5 5.2l11 6.8-11 6.8z"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  more: '<path d="M6 12h.01M12 12h.01M18 12h.01" stroke-width="2.6"/>',
  edit: '<path d="M4.5 19.5l1-4.3L16 4.7a2 2 0 0 1 2.9 0l.4.4a2 2 0 0 1 0 2.9L8.8 18.5z"/><path d="M14.6 6.2l3.2 3.2"/>',
  star: '<path d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 9.7l5.4-.8z"/>',
  eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.5"/>',
  rotate: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5V9H15"/>',
  shuffle: '<path d="M4 7h3.5c1.6 0 2.6.7 3.6 2.1l3.8 5.8c1 1.4 2 2.1 3.6 2.1H20"/><path d="M17 14l3 3-3 3"/><path d="M4 17h3.5c1.6 0 2.6-.7 3.6-2.1"/><path d="M13 8.9C14 7.7 15 7 16.5 7H20"/><path d="M17 4l3 3-3 3"/>',
  globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4c2.5 2.2 3.8 5 3.8 8s-1.3 5.8-3.8 8c-2.5-2.2-3.8-5-3.8-8S9.5 6.2 12 4z"/>',
  translate: '<path d="M4 5.5h9"/><path d="M8.5 3.5v2"/><path d="M10.8 5.5c-.5 4-2.8 7-6.3 8.7"/><path d="M6 9c1 2 2.6 3.6 4.6 4.6"/><path d="M12.5 20.5l4-10 4 10"/><path d="M14 17h5"/>',
  minimize: '<path d="M5 12h14"/>',
  maximize: '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  list: '<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11"/><path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
  focus: '<path d="M9 4.5H5.5a1 1 0 0 0-1 1V9"/><path d="M15 4.5h3.5a1 1 0 0 1 1 1V9"/><path d="M9 19.5H5.5a1 1 0 0 1-1-1V15"/><path d="M15 19.5h3.5a1 1 0 0 0 1-1V15"/>',
  type: '<path d="M5 6.5V4.5h14v2"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/>',
  highlight: '<path d="M5 15.5l8.5-8.5 3 3L8 18.5H5z"/><path d="M4 20.5h16"/>',
  note: '<path d="M5.5 4.5h13v11l-4 4h-9z"/><path d="M14.5 19.5v-4h4"/><path d="M9 9h6M9 12.5h4"/>',
  save: '<path d="M5 4.5h11l3 3v12H5z"/><path d="M8.5 4.5v5h7v-5"/><path d="M8.5 19.5v-6h7v6"/>',
  wifiOff: '<path d="M3 8.5a14 14 0 0 1 5-2.4M11 5.7a14 14 0 0 1 10 2.8"/><path d="M6 12a10 10 0 0 1 4-1.8M14.5 10.5a10 10 0 0 1 3.5 1.5"/><path d="M8.5 15.4a5.5 5.5 0 0 1 7 0"/><path d="M12 19h.01"/><path d="M3.5 3.5l17 17"/>',
  alert: '<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  refresh: '<path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3L20 9"/><path d="M20 4.5V9h-4.5"/><path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4 15"/><path d="M4 19.5V15h4.5"/>',
  heart: '<path d="M12 19.5S4.5 15.2 4.5 9.9A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.9C19.5 15.2 12 19.5 12 19.5z"/>',
  quote: '<path d="M9.5 6.5H5v5h4.5v3.4a3.1 3.1 0 0 1-3.1 3.1"/><path d="M19.5 6.5H15v5h4.5v3.4a3.1 3.1 0 0 1-3.1 3.1"/>',
  graduation: '<path d="M2.5 9.5L12 5l9.5 4.5L12 14z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/><path d="M21.5 9.5v5"/>',
  zap: '<path d="M13 3.5L5.5 13.5H11l-1 7 7.5-10H12z"/>',
  minus: '<path d="M5 12h14"/>',
  square: '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
  arrowUp: '<path d="M12 19.5v-15"/><path d="M6 10.5l6-6 6 6"/>',
  arrowDown: '<path d="M12 4.5v15"/><path d="M6 13.5l6 6 6-6"/>',
  expand: '<path d="M9 4.5H4.5V9"/><path d="M15 4.5h4.5V9"/><path d="M15 19.5h4.5V15"/><path d="M9 19.5H4.5V15"/>',
  sort: '<path d="M7 5v14"/><path d="M7 19l-3-3M7 19l3-3"/><path d="M13 7h7M13 12h5M13 17h3"/>',
  speaker: '<path d="M5 9.5h3l4-3.5v12l-4-3.5H5z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M10 5.6A9.8 9.8 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-2.4 3.2"/><path d="M6.6 7.3A17 17 0 0 0 2.5 12S6 19 12 19c1.4 0 2.7-.4 3.8-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  folder: '<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-.9 2-1.9 0-1.3-1.1-1.7-1.1-2.9 0-1 .8-1.7 1.9-1.7h1.7a4 4 0 0 0 4-4c0-3.6-3.8-6.5-8.5-6.5z"/><circle cx="7.8" cy="10" r=".9" fill="currentColor"/><circle cx="11" cy="7.2" r=".9" fill="currentColor"/><circle cx="15.4" cy="8.2" r=".9" fill="currentColor"/>',
  tag: '<path d="M4.5 11V5.5a1 1 0 0 1 1-1H11l8 8a3 3 0 0 1 0 4.2l-3.8 3.8a3 3 0 0 1-4.2 0z"/><circle cx="8.5" cy="8.5" r="1.2"/>',
  command: '<path d="M8.5 8.5h7v7h-7z"/><path d="M8.5 8.5V6A2.5 2.5 0 1 0 6 8.5z"/><path d="M15.5 8.5V6A2.5 2.5 0 1 1 18 8.5z"/><path d="M8.5 15.5V18A2.5 2.5 0 1 1 6 15.5z"/><path d="M15.5 15.5V18A2.5 2.5 0 1 0 18 15.5z"/>'
};


// 兼容 ui-second 页面使用的 kebab-case / 变体命名
const ALIASES = {
  'chevron-left': 'chevronLeft', 'chevron-right': 'chevronRight', 'arrow-left': 'arrowLeft',
  'arrow-right': 'arrowRight', 'book-open': 'bookOpen', 'close': 'x', 'volume2': 'volume',
  'pencil': 'edit', 'eye-off': 'eyeOff', 'trash-2': 'trash', 'more-horizontal': 'more',
  'panel-left': 'list', 'sort-asc': 'sort'
};
for (const [alias, target] of Object.entries(ALIASES)) if (P[target]) P[alias] = P[target];

export function icon(name, size = 18) {
  const body = P[name];
  if (!body) return '';
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + '</svg>';
}

export const icons = {};
for (const name of Object.keys(P)) icons[name] = (size = 18) => icon(name, size);

export const iconNames = Object.keys(P);
export default icons;