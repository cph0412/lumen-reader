# Lumen Reader · 验收报告

日期：2026-11-19
环境：Windows 10.0.26200 / Electron 45.1.0 / Node 22.19.0  
构建：Electron 无边框窗口，1440×900 截图；Windows 便携版

## 1. 自动化测试

### 单元测试


```bash
npm test
```

结果：**125 passed / 0 failed**（node:test，约 0.9s）

覆盖：
- 编码识别：UTF-8、UTF-8 BOM、UTF-16LE/BE、GB18030 回退、乱码比例
- 章节解析：Chapter / CHAPTER I / PART / 第X章 / Letter / 全大写 / 罗马数字 / 无章节分节
- 原子 JSON 存储与损坏恢复
- 书库导入、示例播种、进度、书签、搜索、旧版 0–1 进度迁移
- EPUB：ZIP 解包、OPF/container、spine 章节、XHTML 标题/段落/实体、单文件多 h1 切分、导入后复用阅读器
- MOBI：PalmDB、PalmDOC 压缩 1/2、pagebreak 章节、标题、导入后复用阅读器
- 翻译 Google→MyMemory 降级、HTML 实体、缓存、AI JSON 容错、本地模型无 Key
- 生词 CRUD、normalized 去重、四档 SRS、due 排序、CSV 导出
- 统计 streak / weekly / heatmap / 补录日期、笔记 CRUD
- 词典：dictionaryapi、牛津 API mock、Oxford 凭证加密/清除、回退逻辑
- 内置词典：90,352 词条、26 个分片、TOEFL 优先、词根/短语/联想、无网络优先命中
- 词根词缀：本地 200+ 词素匹配、AI 联想 mnemonic 缓存与 NO_AI_KEY
- 艾宾浩斯：11 阶段、四档升降级、due 同步、旧数据迁移、schedule
- 示例书真实资源播种

### Electron 端到端

```bash
npm run selftest
```

结果：**29 passed / 0 failed**

覆盖：
1. 本地 AI 无 Key 可用（localhost）
2. 6 本示例书播种
3. 阅读器路由渲染
4. 单章书标题正确（The Gift of the Magi）
5. 选中文本捕获
6. 免费翻译返回中文
7. AI 语境解析渲染（本地 mock 模型）
8. 全局快捷键注册（Alt+Shift+D，占用时回退 Alt+Shift+L）
9. 划词 helper 执行不挂起
10. 全局浮窗打开并翻译
11. 浮窗收藏入生词本
12. 阅读器收藏生词
13. 复习页渲染
14. 翻面并评分
15. 设置页渲染
16. 主题切换并持久化
17. TXT 导入
18. 段落长文翻译（分块）
19. 返回书库后主界面显示最新进度
20. 导入章节解析
21. 关闭自动 AI 解析后，阅读器划词只翻译、不自动请求 AI
22. 关闭自动解析后，全局划词浮窗也改为手动「解析」
23. 本地词根词缀分析
24. AI 联想记忆生成
25. 艾宾浩斯评分后 stage/due 变化与 11 档 schedule
26. 生词详情的记忆 / 词根抽屉
27. 复习页艾宾浩斯曲线渲染
28. 设置页词典与牛津凭证卡
29. 内置 90k 词典命中（source=local）

> 说明：自动化测试运行在远程会话中，Win32 合成输入偶发被系统限制，因此“helper 捕获文本”按“执行不挂起”验收；交互式桌面下已验证可捕获选中文本。

## 2. 视觉验收

真实 Electron 渲染，1440×900：

- `docs/screenshots/01-library.png` 书库 / 继续阅读 / CSS 书封
- `02-reader.png` 沉浸阅读 / Literata / drop cap
- `03-reader-lookup.png` 单词卡 / 翻译 / 内置词典释义 / 词根展开 / AI CTA
- `04-vocabulary.png` 生词表 / 搜索 / 筛选 / 掌握度
- `05-review.png` 复习卡 / 来源 / 翻面
- `06-stats.png` 统计卡 / 周柱状图 / 热力图 / 目标
- `07-settings.png` AI / 翻译 / 阅读 / 通用 / 数据
- `08-quick-lookup.png` 420×480 全局浮窗
- `09-ai-lookup.png` AI 语境解析（含词根/联想，测试用 mock 响应）
- `10-vocabulary-memory.png` 生词详情：记忆阶段 / 词根 / 联想
- `11-settings-dictionary.png` 词典来源与牛津 API 凭证

截图模式使用临时用户目录与演示数据，不污染真实用户数据。

## 3. 打包验收

```bash
npx electron-builder --win portable --x64
```

产物：
- `release/Lumen-1.4.1-portable.exe`（130,605,136 bytes，已写入 Lumen 图标与版本信息）
- `release/win-unpacked/Lumen.exe`

启动验证：便携版进程启动，主窗口标题为“书库 · Lumen 流明阅读”；打包版 `--selftest` 29/29 通过。

## 4. 1.4 MOBI 阅读

- 新增 `src/main/util/mobi.js`：PalmDB 记录表、MOBI/PalmDOC 头、PalmDOC 1/2 解压、pagebreak 章节、HTML 正文抽取。
- 支持 .mobi / 旧版 .azw / .prc；解析标题、作者、章节；导入后复用现有阅读器。
- 明确拒绝 DRM、KF8/AZW3、HUFF/CDIC 压缩，并提示用 Calibre 转为 EPUB。
- 限制：插图与复杂排版不渲染，只读取文字；单文件上限 120 MB。

### 1.4.1 EPUB 兼容修复

- 修复使用 `opf:package` / `opf:manifest` / `opf:spine` 命名空间前缀的 EPUB（此前 manifest/spine 解析为空）。
- 中文正文改用 CJK 字符计数，短章节不再因“无空格”而被误判为不足 20 词。
- EPUB/MOBI 转换使用显式章节标记，避免正文重复标题导致章节翻倍；国富论实测 52 章。
- 新增 OPF 命名空间回归测试，总单元测试 125 项。

## 5. 1.3 EPUB 阅读

- 新增 `src/main/util/epub.js`：最小 ZIP 解包 + `META-INF/container.xml` + OPF manifest/spine + XHTML 正文抽取。
- 支持 EPUB 2/3 的多 XHTML 章节、单文件多 h1 切分、HTML 实体/脚本/样式清理；导入后仍复用现有章节、进度、书签、搜索与划词功能。
- 导入对话框、拖拽提示与书库卡片均加入 EPUB；单文件上限 120 MB；DRM/加密 EPUB 会给出明确错误。
- 限制：插图与复杂排版不渲染，只读取文字。

## 6. 1.2 内置词库

- 合并 **cigen（88,167） + TOEFL（9,213） + 不择手段背单词（7,451）**，去重后 **90,352** 个词条。
- 预生成 26 个按首字母拆分的 gzip JSONL 分片，运行时按需加载，离线可用；TOEFL 结构化释义优先，cigen/Bu_Ze 补充词根、短语与联想。
- 划词卡新增中文释义、短语、词根/词源、联想记忆与可展开的详细记忆；来源标注为「内置词典」。
- 牛津 API 显式选择时优先牛津；自动/免费模式优先内置，未收录时再联网。

## 7. 1.1 新增能力

- **增强词典**：开放词典返回音标、词性、释义、例句、同反义、词形、词源；可选牛津 API，无凭证/失败自动回退开放词典并标注来源。
- **艾宾浩斯记忆曲线**：11 阶段间隔（5 分钟至 120 天），复习页曲线、阶段与四档实际间隔；旧数据自动迁移。
- **词根词缀 / 联想记忆**：本地 217 条词素保守拆解；AI 生成谐音/场景/词根联想并可持久化；生词详情与划词卡均可查看。

### 1.0.4 以来的 UI 修复

- **划词弹窗外形与操作区**：宽度改为 414–474px，标题/选区/播放/来源分层；正文独立滚动、底栏固定；长句支持展开；排版与留白按卡片宽度重新调整。
- **底部操作栏被遮挡**：划词卡底部改为两行——收藏主按钮 + 笔记/复制/朗读/重译四个带文字按钮，悬浮提示不再是唯一信息源。
- **自动 AI 解析不可关闭**：设置页把「自动翻译 / 自动 AI 解析」提到 AI 卡片中的「划词之后」区域，AI 解析提供明确的「自动 / 关闭自动」；关闭后卡片只自动翻译，点击「解析」才请求。设置会通过主进程广播实时同步到阅读器，不再依赖重启。

- **主界面进度不同步**：书库页挂载时强制读取最新 `library.list()`；阅读进度百分比统一为 0–100，旧版 0–1 数据在启动时自动迁移；已读完的书再次阅读时按真实进度显示，不被 `finished` 状态强行覆盖为 100%。
- **段落翻译误报网络错误**：MyMemory 单次查询有约 500 字节上限。长段落现在按句子切块（≤420 字符）分别翻译后拼接，Google 失败时也不会整段报错。

## 8. 已知边界

- 未做代码签名，SmartScreen 可能提示未知发布者；
- 全局划词依赖前台窗口/剪贴板，受保护应用可能失败；
- 免费翻译依赖公网，首次查询有 2–4s 延迟；
- AI 需要用户自备接口，默认不内置公共额度；
- 支持 TXT / EPUB / MOBI / 旧版 AZW；PDF / OCR 在路线图中；
- EPUB / MOBI 只读取文字，插图、脚注弹窗与复杂排版不渲染；带 DRM 的书无法导入；
- MOBI 暂不支持 HUFF/CDIC 压缩与 KF8 / AZW3；
- 牛津词典需要用户自己的 API 凭证；无凭证时用免费开放词典。

## 9. 复现命令

```bash
npm install
npm test
npm run selftest
npm run screenshots
npm run dist
```