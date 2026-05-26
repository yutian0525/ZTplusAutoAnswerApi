# ZTplus 自动答题工具集

针对 ZTplus 平台的自动答题工具集，分为两个子模块，分别覆盖练习与考试场景。

## 模块说明

| 模块 | 路径 | 用途 |
|------|------|------|
| [practice-api](practice-api/) | `practice-api/` | **练习题** — 通过 API 调用自动完成练习，支持题库自动更新 |
| [test-script](test-script/) | `test-script/` | **测试题 / 考试** — 本地题库服务 + 浏览器脚本，自动完成在线考试 |

## 快速选择

- 需要刷 **练习** → 使用 `practice-api`，详见 [practice-api/README.md](practice-api/README.md)
- 需要完成 **测试题或考试** → 使用 `test-script`，详见 [test-script/README.md](test-script/README.md)
