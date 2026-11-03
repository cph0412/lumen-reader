# 内置词典数据

本目录由项目脚本 `scripts/build-dictionaries.js` 从用户提供的三份词表生成：

| 文件 | 词条数 | 说明 |
| --- | ---: | --- |
| `cigen_en_new.jsonl` | 88,167 | 词根记忆、中英释义、例句 |
| `TOEFL.json` | 9,213 | TOEFL 词库，含音标、例句、同义、短语、词族 |
| `Bu_Ze_Shou_Duan_Bei_Dan_Ci.jsonl` | 7,451 | GRE 联想/词源记忆 |

合并去重后共 **90,352** 个词条，按首字母拆成 26 个 gzip JSONL 分片（`shards/*.jsonl.gz`），运行时按需加载。

## 重新生成

在项目根目录准备上述三个源文件后运行：

```bash
node scripts/build-dictionaries.js
```

脚本会重写 `shards/` 和 `manifest.json`。

## 版权 / 来源

这三份词表由用户提供，Lumen 只做格式归一、合并去重和本地检索。词表内容的版权与再分发许可由提供者/原始权利人负责；若要公开发布安装包，请先确认三份数据的授权范围。牛津词典不在此目录中，需通过 Oxford API 凭证单独接入。
