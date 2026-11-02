# 核心服务层（core-dev）

Lumen Reader 主进程服务：纯 CommonJS、仅 Node 内置模块，**不 import electron**，因此可直接被
`node --test` 单测（测试目录：仓库根 `tests/`）。

## 文件

| 文件 | 职责 |
| --- | --- |
| `util/encoding.js` | BOM（UTF-8/UTF-16LE/BE）、严格 UTF-8、GB18030 回退、乱码比例 |
| `util/chapters.js` | 章节识别（Chapter/CHAPTER I/PART ONE/第X章/Letter/全大写/罗马数字/数字）、~4500 词 Section 切分、countWords |
| `services/store.js` | 可靠 JSON store：原子写（tmp+fsync+rename）、默认值、损坏备份重建 |
| `services/library.js` | 书库：导入复制、书名/作者解析、章节读取、进度、书签、搜索、示例书播种 |
| `services/settings.js` | 默认值深合并、API Key 加密存储、脱敏 get / 明文 getRaw |
| `services/translator.js` | Google→MyMemory 免费翻译、AI 语境解析（OpenAI 兼容 / 本地）、连接测试、缓存 |
| `services/vocab.js` | 生词 CRUD、SRS 四档、mastery、stats、CSV 导出（UTF-8 BOM） |
| `services/notes.js` | 笔记 CRUD |
| `services/stats.js` | 阅读足迹：today/totals/streak/weekly/heatmap/daysRead，支持补录 date |

## 公共约定

- 所有服务工厂第一个参数为依赖对象；`dataDir` 必须存在（服务会自行创建子目录）。
- 所有写入通过 `writeFileAtomic`（`store.js` 导出）：临时文件 + fsync + rename，Windows 下带重试。
- JSON 文件损坏时备份为 `<文件名>.corrupt-<ISO时间戳>` 后以默认值重建。
- 日期一律本地时区 `YYYY-MM-DD`；时间戳 ISO 8601。
- 书籍正文写为 UTF-8 到 `<dataDir>/books/<id>.txt`（导入原文件不被修改），`Book.encoding` 记录原始检测编码。

## 各服务要点

### library
- 工厂：`createLibraryService({ dataDir, sampleDir })`；`init()` 建目录、初始化 `library.json` 并（有 sampleDir 时）`ensureSamples()`。
- `library.json`：`{ books, bookmarks, deletedSamples }`。
- Book 形状按契约 5 节；示例书额外带 `level`/`year`（来自 `resources/samples/samples.json`，导入书没有这两个字段）。
- Bookmark 形状：`{ id, bookId, chapterIndex, chapterTitle, percent, label, createdAt }`（`chapterTitle`/`label` 可为空串）。
- `saveProgress` 更新 `progress`/`lastOpenedAt`，并按进度把 `unread → reading → finished`（最后一章 percent≥0.98 视为读完）；**不写统计**，阅读时长/词数由主进程 `stats.record` 记录。
- `search`：`position` 为匹配处在本章内的字符偏移；`snippet` 约 70/110 字符上下文并带省略号；最多 60 条。
- `getChapter` 的 `chapterIndex` 会被夹到合法范围；返回 `{ book, chapter:{index,title,text,wordCount,prev,next,total}, bookmarks }`。
- 用户删除的示例书记忆在 `deletedSamples`，重启不会复活。
- 内存中最近 4 本书的解析结果缓存（含 60 万字符大书，`getChapter`/`search` 不重复解析）。

### settings
- 工厂：`createSettingsService({ dataDir, secret })`；`secret` 为 `{ encrypt(str), decrypt(str) }`（主进程注入 safeStorage 封装），可省略（退化为本地 base64 混淆）。
- 兼容两种 secret 风格：加密结果自带 `enc:`/`b64:` 前缀（main.js 的 codec）或裸密文；**不会出现双前缀**。
- `get()` 返回脱敏设置（`ai.hasApiKey`/`ai.keyHint`，不含 apiKey）；`getRaw()` 含明文 `ai.apiKey`。
- `save(patch)` 深合并；`ai.apiKey` 为空字符串时**不覆盖**；`ai.clearApiKey: true` 才清除。旧版明文 `ai.apiKey` 会在保存时迁移为密文。
- 默认值对齐产品契约（hotkey `Alt+Shift+D`、dailyGoal 30、字号 19/行高 1.9/宽度 700、autoTranslate/autoAnalyze 开启等）。

### translator
- 工厂：`createTranslationService({ settings, fetchImpl?, dataDir? })`。未传 `dataDir` 时自动使用 `settings.dataDir`，因此主进程按契约只传 `{ settings }` 也能持久化 `cache.json`。
- 免费翻译：Google 端点超时 **2.5s**，失败立即降级 MyMemory（**8s**）；两者都失败返回 `error:{code:'NETWORK'}` 而不是抛异常；单次截断 1500 字符；MyMemory 的 HTML entity 会反转义。
- `cache.json`：`{ lookups, analyses }`，lookup 最多 600 条（provider=cache 命中）、analyze 按 text+context hash 最多 200 条；写入是 read-modify-write，会保留文件里其它键（主进程的 history 等不会互相清空）。
- AI：OpenAI 兼容 `POST {baseUrl}/chat/completions`，默认 `https://api.deepseek.com/v1` + `deepseek-chat`，`response_format:{type:'json_object'}`（400 拒绝时自动去掉重试一次）；解析容错（去 code fence、截取首个 `{` 到末个 `}`），字段校验/归一化（collocations、examples、alternatives、level）。
- 无 Key 时远程 `analyze` 抛 `NO_AI_KEY`；hostname 为 `localhost`/`127.0.0.1`/`::1` 的本地服务允许无 Key（`Authorization: Bearer ollama`）。
- 额外提供 `dictionary(word)`（dictionaryapi.dev，失败返回 null；preload 的 `lookup.dictionary` 已接入）与只读 `cache` 引用。
- `testAI()` 发最小请求并返回 `{ok, latency?, message}`。

### vocab
- 工厂：`createVocabService({ dataDir })`；`vocab.json`：`{ words, reviewDays }`。
- 按 `normalized` 去重；重复添加时补齐空字段并返回 `{ word, duplicate:true }`。
- SRS：`again`=10 分钟、`hard`=1 天、`good`=2.5×、`easy`=4×；interval 以天存储（again 为 10/1440）；首档 good=1 天、easy=2 天避免 0×。ease 初始 2.5，范围 1.3–3.5，调整值 again/hard −0.15、good 0、easy +0.15；mastery 0–5（again −1、good +1、easy +2）。
- `stats()`（契约 5.1）：`{ total, due, learning(1-3), mastered(>=4), new(0), reviewedToday, addedToday, streak }`；reviewedToday/streak 来自内部 `reviewDays`（今天无复习则从昨天数）。
- `exportCsv(path?)`：UTF-8 BOM + 中文表头，Excel 可直接打开；未传 path 时写入 `<dataDir>/exports/lumen-vocab-YYYY-MM-DD.csv`。

### stats
- 工厂：`createStatsService({ dataDir, vocab?, settings? })`；`stats.json`：`{ days: { 'YYYY-MM-DD': { minutes, words, lookups, reviews, added, reads } } }`。
- `record({ type:'lookup'|'review'|'read', minutes?, words?, count?, added?, date? })`：同日幂等合并；`date` 可选（补录/截图演示），缺省今天。
- `overview()` 返回契约 5.1 的 `today/totals/streak/weekly(7)/heatmap(84)/daysRead`；若注入 `vocab`/`settings` 则同时合并 `vocab/mastery/goal`，否则返回占位零值由主进程合并（ipc.js 即为后者）。
- `daysRead` 只统计有阅读行为（minutes/words/reads）的日期；streak 统计任意活动日，今天没活动从昨天开始数。

### notes
- 工厂：`createNotesService({ dataDir })`；`notes.json`：`{ notes }`；颜色限定 `amber|rose|sage|sky`（非法值回退 amber）。

## 测试

```
cd D:\CPH\CLAW\money\lumen-reader
npm test
```

覆盖：编码（BOM/GB18030/坏字节）、章节识别与 4500 词切分、store 原子写与损坏恢复、
library 导入/进度/书签/搜索/示例播种/60 万字符大书、settings 加密脱敏与深合并、
translator mock fetch/降级/缓存/AI JSON 容错/无 Key/本地服务、SRS 四档、
vocab stats/CSV、stats streak/补录、notes CRUD。测试全部使用系统临时目录，不触碰真实用户数据。
