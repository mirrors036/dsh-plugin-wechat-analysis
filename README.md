# dsh-plugin-wechat-analysis

DeepSeek Harness（DSH）插件：把「Windows 微信聊天记录」变成「AI 深度关系鉴定 HTML 报告」的端到端工具链，在 322 天 / 20.4 万条真实数据上完整验证。

## 提供什么

- **技能 `wechat-chat-analysis`**（插件加载时自动以 junction 挂到 `~/.agents/skills/`，进入每个会话的技能目录）：完整流程 —— SQLCipher 数据库解密导出（多分片自动发现与合并）→ weflow-cli 兼容 JSON → 标准消息包 → 全量统计 → 分层采样 → AI 深度分析（F 人格画像 / A 关系诊断 / B 依恋分析 / C 危险预警 / D 军师建议 / E 深度发现 / G 祖师爷寄语）→ 交互式 HTML 报告
- **脚本**（`skills/wechat-chat-analysis/scripts/`）：
  - `check_env.mjs` — 环境预检（node/node:sqlite、密钥、数据库账号与全部分片、she-love-me 位置、python），JSON 输出、不回显密钥
  - `nt_decrypt_inspect.mjs` — 单分片诊断（验证密钥、行数、时间范围）
  - `nt_export.mjs` — 单分片解密导出（**固定 4 参**：`<db> <对方wxid> <我的wxid> <输出.json>`）
  - `merge_exports.mjs` — 多分片合并（按时间排序、报告空窗）

## 依赖

- Windows + 微信 4.x（已登录，本地已落库）
- Node ≥ 22.19（`node:sqlite`）
- Python ≥ 3.9（分析阶段）
- **she-love-me 技能**（`~/.agents/skills/she-love-me`）——阶段 5-10（转换/统计/采样/分析/报告）的脚本与心理学框架来自它。本插件不捆绑其代码，缺失时预检会给出指引，导出阶段（0-4）仍可独立使用

## 安装 / 更新

```powershell
dsh plugin --profile desktop add github:mirrors036/dsh-plugin-wechat-analysis
```

本地开发时安装本机源码副本：

```powershell
dsh plugin --profile desktop add file:<插件源码目录的绝对路径>
```

或用 Web 界面的插件市场安装本地包。**安装/更新后需重启 DSH**；重启时插件入口自动把技能 junction 进 `~/.agents/skills/wechat-chat-analysis`（已存在同名目录/其它链接则跳过、绝不覆盖）。

卸载：`dsh plugin --profile desktop remove dsh-plugin-wechat-analysis`；如残留悬空 junction，手动删除 `~/.agents/skills/wechat-chat-analysis`。

## 实战坑备忘（脚本已内置规避，二次开发必读）

1. **PS 5.1 丢弃空字符串参数**：给 node 传 `''` 会导致实参整体左移（曾引发输出文件互相覆盖）。任何调用都不要传空串。
2. `nt_export.mjs` 内部 `myWxid = process.argv[6] || ownWxid` —— 只有 4 参形式是正确调用。
3. 微信 4.x **滚动分片**：写满 `message_0.db` 后切 `message_1.db`；新消息在最新分片。分析前必须对每个含目标联系人的分片各导一份再合并。
4. 分片旁活跃的 `-wal` 未 checkpoint，按主文件解密会损失最近几分钟消息——报告里注明数据截止时间即可。
5. 明文解密库落在 `%TEMP%\nt_decrypt`，**导出完必删**。
6. 微信数据库密钥在 `~/.miyu/config.json`（keyHex）；缺失时用 she-love-me 的官方扫描组件流程补（`diagnose_ciphertalk.py --scan-key --download-scanner`）。密钥与聊天正文永远不进对话。

## 许可与边界

- 本插件自有代码（导出工具链、预检、技能文档、插件入口）以 MIT 发布（见 LICENSE）。
- she-love-me 技能是第三方项目（github.com/863401402/she-love-me，无 LICENSE 声明），**未被捆绑**，仅运行时引用其已安装副本。
- 因此**本插件仓库可自由发布**；但不要往包里拷贝 she-love-me 的脚本/文档后再发布（那会构成无授权再分发）。
- 微信数据库与导出的聊天记录是高度敏感个人数据，只留在本机用户指定目录。
