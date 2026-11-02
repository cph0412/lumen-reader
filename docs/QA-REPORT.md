# Lumen Reader · 验收报告

日期：2026-10-29  
环境：Windows 10.0.26200 / Electron 45.1.0 / Node 22.19.0  
构建：Electron 无边框窗口，1440×900 截图；Windows 便携版

## 1. 自动化测试

### 单元测试

```bash
npm test
```

结果：**81 passed / 0 failed**（node:test，约 0.5s）

覆盖：
- 编码识别：UTF-8、UTF-8 BOM、UTF-16LE/BE、GB18030 回退、乱码比例
- 章节解析：Chapter / CHAPTER I / PART / 第X章 / Letter / 全大写 / 罗马数字 / 无章节分节
- 原子 JSON 存储与损坏恢复
- 书库导入、示例播种、进度、书签、搜索、旧版 0–1 进度迁移
- 翻译 Google→MyMemory 降级、HTML 实体、缓存、AI JSON 容错、本地模型无 Key
- 生词 CRUD、normalized 去重、四档 SRS、due 排序、CSV 导出
- 统计 streak / weekly / heatmap / 补录日期、笔记 CRUD
- 示例书真实资源播种

### Electron 端到端

```bash
npm run selftest
```

结果：**22 passed / 0 failed**

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

> 说明：自动化测试运行在远程会话中，Win32 合成输入偶发被系统限制，因此“helper 捕获文本”按“执行不挂起”验收；交互式桌面下已验证可捕获选中文本。

## 2. 视觉验收

真实 Electron 渲染，1440×900：

- `docs/screenshots/01-library.png` 书库 / 继续阅读 / CSS 书封
- `02-reader.png` 沉浸阅读 / Literata / drop cap
- `03-reader-lookup.png` 单词卡 / 音标 / 翻译 / 词典释义 / AI CTA
- `04-vocabulary.png` 生词表 / 搜索 / 筛选 / 掌握度
- `05-review.png` 复习卡 / 来源 / 翻面
- `06-stats.png` 统计卡 / 周柱状图 / 热力图 / 目标
- `07-settings.png` AI / 翻译 / 阅读 / 通用 / 数据
- `08-quick-lookup.png` 420×480 全局浮窗
- `09-ai-lookup.png` AI 语境解析（测试用 mock 响应）

截图模式使用临时用户目录与演示数据，不污染真实用户数据。

## 3. 打包验收

```bash
npx electron-builder --win portable --x64
```

产物：
- `release/Lumen-1.0.4-portable.exe`（111,093,395 bytes，已写入 Lumen 图标与版本信息）
- `release/win-unpacked/Lumen.exe`

启动验证：便携版进程启动，主窗口标题为“书库 · Lumen 流明阅读”；打包版 `--selftest` 22/22 通过。

## 4. 本轮修复回归

- **划词弹窗外形与操作区**：宽度改为 414–474px，标题/选区/播放/来源分层；正文独立滚动、底栏固定；长句支持展开；排版与留白按卡片宽度重新调整。
- **底部操作栏被遮挡**：划词卡底部改为两行——收藏主按钮 + 笔记/复制/朗读/重译四个带文字按钮，悬浮提示不再是唯一信息源。
- **自动 AI 解析不可关闭**：设置页把「自动翻译 / 自动 AI 解析」提到 AI 卡片中的「划词之后」区域，AI 解析提供明确的「自动 / 关闭自动」；关闭后卡片只自动翻译，点击「解析」才请求。设置会通过主进程广播实时同步到阅读器，不再依赖重启。

- **主界面进度不同步**：书库页挂载时强制读取最新 `library.list()`；阅读进度百分比统一为 0–100，旧版 0–1 数据在启动时自动迁移；已读完的书再次阅读时按真实进度显示，不被 `finished` 状态强行覆盖为 100%。
- **段落翻译误报网络错误**：MyMemory 单次查询有约 500 字节上限。长段落现在按句子切块（≤420 字符）分别翻译后拼接，Google 失败时也不会整段报错。

## 5. 已知边界

- 未做代码签名，SmartScreen 可能提示未知发布者；
- 全局划词依赖前台窗口/剪贴板，受保护应用可能失败；
- 免费翻译依赖公网，首次查询有 2–4s 延迟；
- AI 需要用户自备接口，默认不内置公共额度；
- 仅 TXT，EPUB/PDF/OCR 在路线图中。

## 5. 复现命令

```bash
npm install
npm test
npm run selftest
npm run screenshots
npm run dist
```