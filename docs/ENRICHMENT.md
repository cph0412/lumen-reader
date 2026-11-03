# Lumen 1.1 功能增强契约

版本目标：1.1.0
- 更完整的词典（免费开放词典 + 可选牛津 API）
- 艾宾浩斯记忆曲线复习
- 词根词缀 / 联想记忆

## 写作用域

| 模块 | 所有者 | 文件 |
| --- | --- | --- |
| 后端：词典/词根/记忆曲线 | core-enrich | `src/main/services/*.js`（含 settings/translator/vocab）、`tests/*.test.js` |
| 复习页曲线 UI | ui-review | `src/renderer/js/pages/review.js`、`styles/review.css` |
| 生词详情 + 设置词典 UI | ui-vocab | `src/renderer/js/pages/vocab.js`、`styles/vocab.css`、`src/renderer/js/pages/settings.js`、`styles/settings.css` |
| 划词卡词典展示 + IPC 集成 | Lead | `src/renderer/js/pages/reader.js`、`styles/reader.css`、`src/main/ipc.js`、`preload.js`、`app.js` 等 |

**不要修改他人文件。** 先读 docs/CONTRACT.md 与现有代码。

## 1. Settings 扩展

```ts
dictionary: {
  provider: 'auto' | 'free' | 'oxford';  // auto: 有牛津凭证用牛津，否则 free
  oxfordAppId: string;
  hasOxfordAppKey: boolean;   // get() 脱敏
  oxfordKeyHint: string;
}
```

- `getRaw().dictionary.oxfordAppKey` 为解密后的 key，仅主进程使用。
- 牛津 App Key 必须用现有 safeStorage secret 加密保存，不能落明文。
- 默认 provider='auto'，无凭证时走免费开放词典。
- 设置保存深合并；空 key 不覆盖，`clearOxfordKey:true` 清除。
- 牛津 API：`GET https://od-api.oxforddictionaries.com/api/v2/entries/en-gb/{word}?fields=definitions,examples,pronunciations,synonyms,antonyms,etymologies,lexicalCategory`，headers `app_id`, `app_key`。
- 牛津数据是商业授权内容，不内置、不缓存到磁盘超过现有词典缓存（200 条）；UI 注明“需要自己的牛津 API 凭证”。

## 2. 词典结果 DictionaryResult

```ts
{
  word: string;
  phonetic?: string;
  audio?: string;
  source: 'oxford' | 'free' | 'local';
  sourceLabel: string;        // '牛津词典' | '开放词典' | '本地'
  meanings: Array<{
    partOfSpeech: string;
    definition: string;
    definitionZh?: string;
    example?: string;
    synonyms: string[];
    antonyms: string[];
  }>;
  synonyms: string[];
  antonyms: string[];
  origin?: string;
  forms?: Array<{ form: string; type?: string }>;
  url?: string;
}
```

免费源：dictionaryapi.dev。解析 `meanings[].definitions[].synonyms/antonyms`、`examples`、`origin`、`phonetics`。牛津源优先。
静态 API：`translator.dictionary(word)`（保留现有签名）或 `createDictionaryService`，由 IPC 调用。

## 3. 词根词缀 / 联想记忆

新增 `src/main/services/lexicon.js` + `roots-data.js`（纯数据，打包进 asar）：

```js
createLexiconService({ dataDir, fetchImpl? }): {
  analyze(word): LexiconResult;               // 本地，同步
  mnemonic({ word, translation, context }): Promise<MnemonicResult>; // AI，可失败
}
```

```ts
LexiconResult = {
  word: string;
  breakdown: string;          // "un-（不）+ happy（快乐）"
  parts: Array<{ text: string; type: 'prefix'|'root'|'suffix'; meaning: string; note?: string }>;
  related: string[];          // 同词根词
  source: 'local';
};

MnemonicResult = {
  mnemonic: string;           // 中文联想/谐音/场景记忆
  associations: string[];     // 2-5 条联想
  wordFamily: string[];       // 同根/同族词
  source: 'ai';
};
```

- 本地词根数据覆盖常用前缀/后缀/词根（至少 60 个），匹配要保守，避免把普通词硬拆。
- `mnemonic` 使用 OpenAI 兼容接口，无 key 抛 `NO_AI_KEY`；缓存 text hash。
- AI 解析（`translator.analyze`）的 JSON 增加可选字段：
  `roots: [{text,type,meaning}]`, `mnemonic: string`, `associations: string[]`。
  UI 可展示；旧字段不变。

## 4. 艾宾浩斯记忆曲线

vocab 记录新增 `memory`，并保留旧 `srs` 兼容字段：

```ts
memory: {
  stage: number;             // 0..10
  intervalHours: number;
  due: string;               // ISO
  lastRating?: 'again'|'hard'|'good'|'easy';
  lapses: number;
  history: Array<{ at: string; rating: string; stage: number; intervalHours: number }>; // 最近 30 条
}
```

阶段（小时）：
`[1/12 (5min), 0.5, 12, 24, 48, 96, 168, 360, 720, 1440, 2880]`
对应 5分钟、30分钟、12小时、1天、2天、4天、7天、15天、30天、60天、120天。

评分映射：
- again：stage=0，lapses+1，mastery-1
- hard：stage=max(0, stage-1)
- good：stage=min(10, stage+1)
- easy：stage=min(10, stage+2)
- due = now + intervals[stage] 小时；srs.due 同步；srs.interval 用天（intervalHours/24）。
- 旧数据迁移：按 `srs.reps/mastery` 估算 stage，due 保持；无 memory 时 stage 由 mastery 映射。
- `vocab.schedule()` 返回 `{ intervals:[{stage,hours,label}], maxStage }`。
- `vocab.stats()` 增加 `stages: number[]`（各 stage 单词数），保留旧字段。

## 5. Preload / IPC 新 API

```ts
lookup: {
  dictionary(word): Promise<DictionaryResult | null>;  // 已有，返回增强结构
  lexicon(word): Promise<LexiconResult>;
  mnemonic(input: {word:string; translation?:string; context?:string}): Promise<MnemonicResult>;
}
vocab: {
  schedule(): Promise<{intervals:Array<{stage:number;hours:number;label:string}>; maxStage:number}>;
  // existing add/update 支持保存 mnemonic/associations/lexicon? 建议 update 接受：
  // { mnemonic?:string; associations?:string[]; lexicon?:object }
}
settings: {
  testDictionary(): Promise<{ok:boolean; provider:string; message:string}>;
}
```

- `main.js` 创建 lexicon service，传 settings/translator；`ipc.js` 接好。
- 词典/词根结果缓存合理；网络失败返回 null / 错误，不崩。

## 6. UI 要求

### 划词卡词典区（Lead）
- 显示 sourceLabel（牛津词典/开放词典）。
- 释义：词性 + 英文释义 + 例句；同义词/反义词 chips。
- 词源 origin（折叠/简短）；词形 forms。
- AI 解析结果额外展示 roots/mnemonic/associations（如果有）。
- 内容多时内部滚动，不撑破弹窗。

### 生词详情（ui-vocab）
- 抽屉内新增“记忆”区块：
  - 艾宾浩斯阶段、下次复习、学习历史（简短）
  - 词根词缀 breakdown + parts chips
  - 联想记忆 mnemonic + associations；未生成时按钮“AI 生成联想”
  - 生成后调用 vocab.update 持久化
- 保持现有笔记/标签/删除。

### 复习页（ui-review）
- 增加“艾宾浩斯记忆曲线”可视化卡片：SVG 衰减曲线 + 当前词阶段/下次间隔。
- 四档评分按钮显示实际间隔（基于 vocab.schedule + word.memory.stage）。
- 完成页显示今日复习阶段分布。
- 不破坏现有键盘 1-4、翻面、完成态。

### 设置（ui-vocab）
- 新增“词典”卡片：provider 三选一（自动/开放词典/牛津 API）；App ID / App Key；保存/测试连接；牛津商业授权说明。
- 设置保存后同步。

## 7. 测试/验收

- `npm test` 全绿（新增 lexicon、Ebbinghaus、Oxford mock、settings key 测试）。
- `npm run selftest` 全绿，新增：词典增强字段、Ebbinghaus 评分后 due 变化、词根分析、AI 联想（mock）。
- 截图：划词卡（含词典/词源）、复习页曲线、生词详情记忆区、设置词典卡。
