# Lumen Reader — 工程契约 v1

> 本文件是并行开发的唯一接口契约。所有 agent 必须按此实现，不擅自改名/改形状。
> 项目根：`D:\CPH\CLAW\money\lumen-reader`
> 技术栈：Electron 45 + 原生 HTML/CSS/ES Modules；主进程 CommonJS；无前端构建步骤。

## 1. 目录与写作用域

| 区域 | 所有者 | 文件 |
| --- | --- | --- |
| 主进程骨架 / 集成 | Lead | `src/main/main.js`, `preload.js`, `ipc.js`, `windows.js`, `hotkey.js`, `protocols.js` |
| 核心服务 | core-dev | `src/main/services/*.js`, `src/main/util/*.js`, `tests/*.test.js` |
| 主界面 / 书库 / 阅读器 | ui-main | `src/renderer/index.html`, `styles/base.css`, `library.css`, `reader.css`, `js/app.js`, `ui.js`, `icons.js`, `pages/library.js`, `pages/reader.js` |
| 生词 / 复习 / 统计 / 设置 / 快捷面板 | ui-second | `styles/vocab.css`, `review.css`, `stats.css`, `settings.css`, `quick.css`, `js/pages/vocab.js`, `review.js`, `stats.js`, `settings.js`, `quick.html`, `js/quick.js` |
| 产品分析 | researcher | `docs/feature-analysis.md` |
| 资源 / 打包 / README / 截图 | Lead | 其余 |

**禁止修改他人文件。** 需要接口变更时，向 Lead 报告，不直接改契约。

## 2. 渲染进程路由

Hash 路由：
- `#/library` 书库（默认）
- `#/read/<bookId>/<chapterIndex?>` 阅读器
- `#/vocab` 生词本
- `#/review` 复习
- `#/stats` 足迹
- `#/settings` 设置

`app.js` 负责路由、侧边栏、页面挂载。页面模块契约：

```js
// js/pages/*.js
export async function render(root, ctx) { /* root.innerHTML = ... */ }
```

`ctx`：
```ts
{
  api: Window['lumen'],                 // 可能为 mock（浏览器预览时）
  navigate(path: string): void,          // 例 'read/abc', 'vocab'
  toast(message: string, tone?: 'ok'|'warn'|'error'): void,
  icons: Record<string, (size?: number) => string>, // 返回内联 SVG 字符串
  state: { books: Book[], settings: Settings, vocabStats: object },
  refreshShell(): Promise<void>,
  openBook(id: string, chapter?: number): void,
  confirm(opts: {title, body, confirmText?, danger?}): Promise<boolean>,
  modal(html: string, opts?): { close(): void, root: HTMLElement },
  escapeHtml(s: string): string,
  formatDate(iso: string, style?: 'short'|'long'): string,
  fmtNumber(n: number): string
}
```

`app.js` 在进入页面前加载 `ctx.state.books` 与 `ctx.state.settings`。页面可以自行调用 `api`。

## 3. 设计语言（必须遵守）

品牌：**Lumen · 流明阅读**。slogan：**把每一页，读成自己的语言。**

- 气质：暖纸、编辑排版、低饱和、克制。不要紫色渐变、不要 glassmorphism 滥用、不要圆角过大。
- 主色：纸白 `#F6F1E7`，墨色 `#23211D`，陶土橙 `#B85C38`（强调），苔绿 `#3F5D4B`，暖灰 `#8B8378`。
- 暗色主题：`#151513` 背景，`#E8E1D5` 文字，同一陶土强调色。
- 字体：正文 Literata（已放 `assets/fonts/Literata*.woff2`）；UI 用 `"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI"`；标题可用 Literata + 中文衬线回退。
- 圆角 10–14px；边框 1px 半透明；阴影极柔和；动效 150–240ms ease。
- 布局：左侧 76px 图标导航栏（可展开 208px），内容区最大 1240px。
- 书封：不使用外部图片，用 CSS 生成布面书封（书名排版 + 纹理 + 书脊），每本书由 `palette` 0–5 决定配色。
- 空状态、加载骨架、错误提示必须精致，不能出现原生 alert 风格。
- 图标：内联 SVG，1.6 stroke，24 网格；`icons.js` 统一导出。
- **CSS 变量（base.css 必须定义，所有页面共用）**：
  `--bg`, `--bg-soft`, `--card`, `--card-soft`, `--ink`, `--ink-soft`, `--muted`, `--line`, `--accent`, `--accent-deep`, `--accent-soft`, `--sage`, `--sage-soft`, `--danger`, `--shadow-sm`, `--shadow-md`, `--radius`, `--radius-lg`, `--font-ui`, `--font-read`, `--sidebar-w`, `--topbar-h`。
  `<html data-theme="paper|sepia|dark">` 切换主题；暗色变量在 base.css 中定义。页面 CSS 不得重复定义这些基础变量。
- 页面 CSS 加载顺序：`base.css` → 各页面 CSS。`index.html` 由 ui-main 写，必须引入 `vocab.css, review.css, stats.css, settings.css`；`quick.html` 单独引入 `base.css + quick.css`。
- 通用交互类名由 `base.css` 提供：`.btn`, `.btn.primary`, `.btn.ghost`, `.icon-btn`, `.card`, `.chip`, `.input`, `.select`, `.toggle`, `.empty`, `.skeleton`, `.page-head`, `.kbd`, `.tooltip`。各页面优先复用。

## 4. Preload API（`window.lumen`）

所有方法返回 Promise；失败时 reject 一个 Error，`error.code` 可能是 `NO_AI_KEY`, `NETWORK`, `NOT_FOUND`, `INVALID_FILE` 等。UI 必须 try/catch 并友好提示。

```ts
window.lumen = {
  platform: 'win32',
  app: {
    info(): Promise<{version:string; dataDir:string; platform:string}>,
    windowAction(action: 'minimize'|'maximize'|'close'): Promise<void>,
    openDataFolder(): Promise<void>,
    openExternal(url: string): Promise<void>,
    getPathForFile(file: File): string,       // 拖拽导入
  },
  library: {
    list(): Promise<Book[]>,
    get(id: string): Promise<Book>,
    importFiles(): Promise<{imported: Book[]; canceled: boolean; errors: string[]}>,
    importPaths(paths: string[]): Promise<{imported: Book[]; errors: string[]}>,
    remove(id: string): Promise<{ok:true}>,
    setFavorite(id: string, favorite: boolean): Promise<Book>,
    saveProgress(input: {
      bookId: string; chapterIndex: number; percent: number; scrollTop?: number;
      minutesDelta?: number; wordsDelta?: number;
    }): Promise<Book>,
    setStatus(id: string, status: 'unread'|'reading'|'finished'): Promise<Book>,
  },
  reader: {
    getChapter(bookId: string, chapterIndex: number): Promise<{
      book: Book;
      chapter: { index:number; title:string; text:string; wordCount:number;
                 prev:number|null; next:number|null; total:number };
      bookmarks: Bookmark[];
    }>,
    search(bookId: string, query: string): Promise<Array<{
      chapterIndex:number; chapterTitle:string; snippet:string; position:number;
    }>>,
    toggleBookmark(input: {bookId:string; chapterIndex:number; percent:number; label?:string}): Promise<{added:boolean; bookmark?:Bookmark}>,
  },
  lookup: {
    quick(input: {text:string; context?:string; bookId?:string}): Promise<LookupResult>,
    analyze(input: {text:string; context?:string; bookId?:string; chapterTitle?:string}): Promise<AIAnalysis>,
    dictionary(word: string): Promise<DictionaryResult | null>,
    history(limit?: number): Promise<LookupHistoryItem[]>,
  },
  vocab: {
    list(filter?: {query?:string; sort?:'recent'|'alpha'|'due'; mastery?:number}): Promise<VocabWord[]>,
    add(input: AddVocabInput): Promise<{word: VocabWord; duplicate: boolean}>,
    update(id: string, patch: Partial<VocabWord>): Promise<VocabWord>,
    remove(id: string): Promise<{ok:true}>,
    due(limit?: number): Promise<VocabWord[]>,
    review(id: string, rating: 'again'|'hard'|'good'|'easy'): Promise<VocabWord>,
    stats(): Promise<VocabStats>,
    exportCsv(): Promise<{saved: boolean; path?: string}>,
    isSaved(normalized: string): Promise<VocabWord | null>,
  },
  notes: {
    list(bookId?: string): Promise<Note[]>,
    add(input: AddNoteInput): Promise<Note>,
    remove(id: string): Promise<{ok:true}>,
  },
  stats: {
    overview(): Promise<StatsOverview>,
    record(input: {type:'lookup'|'review'|'read'; minutes?:number; words?:number; count?:number}): Promise<void>,
    heatmap(days?: number): Promise<Array<{date:string; minutes:number; words:number}>>,
  },
  settings: {
    get(): Promise<Settings>,
    save(patch: DeepPartial<Settings>): Promise<Settings>,
    testAI(): Promise<{ok:boolean; latency?:number; message:string}>,
    exportData(): Promise<{saved:boolean; path?:string}>,
    importData(): Promise<{imported:boolean; message?:string}>,
  },
  quick: {
    hide(): Promise<void>,
    showForSelection(text: string): Promise<void>,
  },
  events: {
    onQuickLookup(cb: (data:{text:string}) => void): () => void,
    onNavigate(cb: (data:{route:string; bookId?:string}) => void): () => void,
    onTheme(cb: (theme:'paper'|'sepia'|'dark') => void): () => void,
  }
}
```

## 5. 数据形状

```ts
type Book = {
  id: string; title: string; author: string; description?: string;
  fileName: string; source: 'imported'|'sample';
  encoding: string; language: 'en'; sizeBytes: number; wordCount: number; charCount: number;
  addedAt: string; lastOpenedAt: string|null;
  chapterCount: number;
  progress: { chapterIndex:number; percent:number /* 0..100 */; scrollTop:number };
  status: 'unread'|'reading'|'finished';
  palette: number; favorite: boolean;
  chapters: Array<{index:number; title:string; wordCount:number}>;
};

type DictionaryResult = {
  word: string; phonetic?: string; audio?: string;
  meanings: Array<{partOfSpeech:string; definition:string; example?:string}>;
  source: 'dictionaryapi'|'local';
};

type LookupResult = {
  text: string; kind: 'word'|'phrase'|'sentence'|'paragraph';
  normalized: string;
  translation: string;
  provider: 'google-free'|'mymemory'|'ai'|'dictionary'|'cache';
  dictionary: DictionaryResult|null;
  note?: string;
  error?: {code:string; message:string};
  analyzed: boolean;
};

type AIAnalysis = {
  translation: string;
  sense: string;          // 语境中的确切含义
  grammar: string;        // 结构 / 语法
  nuance: string;         // 语气、搭配、使用场景
  collocations: string[];
  examples: Array<{en:string; zh:string}>;
  alternatives: string[];
  level?: string;         // CEFR
};

type VocabWord = {
  id: string; word: string; normalized: string; phonetic?: string;
  translation: string; context: string; contextTranslation?: string;
  source: { bookId?:string; bookTitle?:string; chapterTitle?:string };
  note?: string; tags: string[];
  createdAt: string; updatedAt: string; lastReviewedAt?: string;
  srs: { due:string; interval:number; ease:number; reps:number; lapses:number };
  mastery: number; // 0..5
};

type Note = {
  id:string; bookId:string; bookTitle:string; chapterIndex:number; chapterTitle:string;
  text:string; note:string; color:'amber'|'rose'|'sage'|'sky';
  percent:number; // 0..100
  createdAt:string;
};

type Settings = {
  ai: { baseUrl:string; model:string; hasApiKey:boolean; local:boolean; available:boolean; keyHint:string; temperature:number };
  translation: { provider:'auto'|'free'|'ai'; target:'zh-CN' };
  reader: {
    theme:'paper'|'sepia'|'dark'; fontSize:number; lineHeight:number;
    fontFamily:'serif'|'sans'; contentWidth:number; letterSpacing:number;
    justify:boolean; highlightVocab:boolean; autoTranslate:boolean; autoAnalyze:boolean;
  };
  general: { hotkey:string; minimizeToTray:boolean; dailyGoalMinutes:number };
};
```



## 5.1 补充：二级页面使用的类型（权威）

```ts
type AddVocabInput = {
  word: string;
  phonetic?: string;
  translation?: string;
  context?: string;
  contextTranslation?: string;
  source?: { bookId?:string; bookTitle?:string; chapterTitle?:string };
  note?: string;
  tags?: string[];
  lookup?: { provider?:string; kind?:string };
};

type VocabStats = {
  total: number;
  due: number;        // 今天到期
  learning: number;   // mastery 1-3
  mastered: number;   // mastery >= 4
  new: number;        // mastery 0
  reviewedToday: number;
  addedToday: number;
  streak: number;     // 连续复习天数，可为 0
};

type StatsOverview = {
  today: { minutes:number; words:number; lookups:number; reviews:number; added:number };
  totals: { minutes:number; words:number; lookups:number; reviews:number };
  streak: number;
  weekly: Array<{ date:string; minutes:number; words:number; lookups:number }>;
  heatmap: Array<{ date:string; minutes:number; words:number }>;
  daysRead: number;
  vocab: { total:number; due:number; learning:number; mastered:number; new:number };
  mastery: { new:number; learning:number; mastered:number };
  goal: { minutes:number };
};

type LookupHistoryItem = {
  id: string;
  text: string;
  kind: 'word'|'phrase'|'sentence'|'paragraph';
  translation: string;
  provider: string;
  bookId?: string;
  bookTitle?: string;
  chapterTitle?: string;
  createdAt: string;
};
```

- `lookup.history` 由主进程维护，最多 100 条，倒序。
- `vocab.stats()` 的 `due/learning/mastered/new` 与 `stats.overview().vocab` 必须一致。
- `stats.overview()` 由主进程在核心 stats 数据上合并 vocab stats 与 settings 目标后返回。
- 所有日期使用本地时区，格式 `YYYY-MM-DD`，时间戳 ISO 8601。
- `stats.record` 接受可选 `date:'YYYY-MM-DD'` 供测试/补录/截图演示；缺省为今天。

## 5.2 quick 浮窗主进程约定

- 尺寸 420×480，透明无边框，`hasShadow:false`（阴影由 CSS 画），加载 `app://lumen/quick.html`。
- 每次划词通过 `quick:data` 事件推送 `{ text, source:'selection'|'clipboard'|'none', error?:string }`；随后 show/focus。
- `app.openMain()` 存在：显示主窗并隐藏浮窗。
- 保存设置时主进程向所有窗口广播 `settings:changed`，并向 quick 窗口发 `app:theme` =`reader.theme`。

## 6. 核心服务接口（CommonJS）

**所有服务不得直接 import electron**，以便 node:test 单测。工厂函数接收 `dataDir` 等依赖。

```js
// util/encoding.js
detectAndDecode(buffer: Buffer): { text: string, encoding: string }

// util/chapters.js
parseChapters(text: string): { chapters: Array<{index,title,start,end,wordCount}>, title?: string }
countWords(text: string): number

// services/store.js
createJsonStore({ filePath, defaults }): {
  read(): object; write(data): void; update(fn): object;
}

// services/library.js
createLibraryService({ dataDir, sampleDir }): {
  init(): Promise<void>;
  list(): Book[];
  get(id): Book;
  getChapter(bookId, chapterIndex): ChapterPayload;
  search(bookId, query): SearchHit[];
  importPaths(paths): Promise<{imported, errors}>;
  remove(id): {ok:true};
  setFavorite(id, favorite): Book;
  saveProgress(input): Book;
  setStatus(id, status): Book;
  toggleBookmark(input): {added, bookmark?};
  listBookmarks(bookId): Bookmark[];
  ensureSamples(): Promise<void>;
}

// services/settings.js
createSettingsService({ dataDir, secret }): {
  get(): Settings;            // 返回脱敏（hasApiKey/keyHint）
  getRaw(): Settings;         // 含解密后的 apiKey，仅主进程用
  save(patch): Settings;
}

// services/translator.js
createTranslationService({ settings, fetchImpl? }): {
  lookup({ text, context }): Promise<LookupResult>;
  analyze({ text, context, chapterTitle }): Promise<AIAnalysis>;
  testAI(): Promise<{ok, latency?, message}>;
}

// services/vocab.js
createVocabService({ dataDir }): {
  list(filter?): VocabWord[]; add(input): {word, duplicate}; update(id,patch): VocabWord;
  remove(id); due(limit?): VocabWord[]; review(id,rating): VocabWord; stats(): VocabStats;
  isSaved(normalized): VocabWord|null; exportCsv(path?): {saved,path?};
}

// services/notes.js
createNotesService({ dataDir }): { list(bookId?), add(input), remove(id) }

// services/stats.js
createStatsService({ dataDir }): {
  overview(): StatsOverview; record(input): void; heatmap(days?): Array<{date,minutes,words}>;
}
```

## 7. 关键行为

- 编码：UTF-8 BOM、UTF-16LE/BE BOM、UTF-8 严格解码、GB18030 回退；乱码字符过多时尝试 GB18030。导入时复制到 `dataDir/books/<id>.txt`，原文件不动。
- 章节识别：`Chapter 1`/`CHAPTER I`/`PART ONE`/`第X章`/全大写短行/数字标题；找不到章节则按 ~4500 词切分并命名 "Section 1"。
- 书名：首个非空行（<=80 字符）作为标题；`by ...` 行作为作者；否则文件名。
- 免费翻译：Google 非官方端点优先，失败后 MyMemory；单次截断 1500 字符。网络错误返回带 `error` 的结果，不抛异常（UI 可展示"翻译服务暂不可用"）。
- AI：OpenAI 兼容 `/chat/completions`；默认 `https://api.deepseek.com/v1` + `deepseek-chat`；`response_format:{type:'json_object'}`，失败则从文本提取 JSON；必须校验并归一化字段。无 key 时 analyze 抛 `NO_AI_KEY`。
- 缓存：lookup 结果内存 + `cache.json`（最多 600 条）；analyze 按 text+context hash 缓存 200 条。
- SRS：again=10 分钟；hard=1 天；good=2.5×；easy=4×；ease 初始 2.5，根据评分 ±0.15；mastery 0–5。
- 数据文件：`library.json`, `settings.json`, `vocab.json`, `notes.json`, `stats.json`, `cache.json`, `books/`。所有写入原子（tmp + rename）。
- 统计：按本地日期 YYYY-MM-DD；阅读记录由 saveProgress 内部记 minutesDelta/wordsDelta；lookup/review 通过 stats.record。streak 按连续有活动的日期计算（今天未读则从昨天算）。
- 隐私：API key 使用 Electron safeStorage 加密（主进程注入 secret 编解码器）；免费翻译会把选中文本发送到 Google/MyMemory，首次启用需在设置页明示。

## 8. 质量门槛

- `npm test` 全部通过。
- 应用能启动、导入 TXT、打开章节、选中文本出翻译卡、保存生词、复习、切换主题。
- 无未捕获异常；空数据/断网/无 API key 均有优雅状态。
- 截图 1440×900，页面无横向滚动，阅读器正文排版舒适。