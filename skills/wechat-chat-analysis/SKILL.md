---
name: wechat-chat-analysis
description: "端到端分析 Windows 微信 4.x 本机聊天记录：解密 SQLCipher 数据库并导出（多分片自动发现与合并）→ 标准消息包转换 → 全量统计 → 分层采样 → AI 关系深度分析 → 交互式 HTML 报告。当用户提到：分析/导出微信聊天记录、分析最新聊天记录、聊天记录鉴定、基于聊天记录的感情/关系分析、微信数据库解密导出、继续或复用既有的聊天分析工程时使用。分析框架与报告生成依赖本机已安装的 she-love-me 技能；本技能提供经实战验证的导出工具链与完整流程。"
compatibility: Windows · 微信 4.x 已登录 · Node ≥22.19（node:sqlite）· Python ≥3.9 · she-love-me 技能（分析阶段）
---

# 微信聊天记录端到端分析

把 Windows 微信（4.x）本机加密数据库变成一份 AI 深度关系鉴定报告。本技能在 322 天 / 20 万条的真实数据上完整验证过。

## 铁律（先读，违反即返工）

1. **隐私**：不把数据库密钥、聊天正文输出到对话；只展示联系人名称、消息条数、时间范围、生成路径。明文导出数据只落在用户指定的工程目录里。
2. **等待用户**：联系人选择、时间范围选择必须真实等待用户回复，不要替用户决定。
3. **PS 5.1 丢空参**：PowerShell 5.1 给 node 传参会丢弃空字符串 `''`，导致后续实参整体左移。**绝不给 node 脚本传空字符串参数**。
4. **收尾清理**：导出完成后删除 `%TEMP%\nt_decrypt`（明文解密库，数百 MB 敏感数据）。

## 阶段 0：环境预检

```powershell
node <skill-dir>\scripts\check_env.mjs
```

输出 JSON：node/node:sqlite、密钥配置（只报有无，不报值）、微信数据库账号与全部分片、she-love-me 技能位置、可用的 python。任何一项缺失按 `hints` 处理。

- 密钥缺失（`~/.miyu/config.json` 无 keyHex）：按 she-love-me 的 data-sources.md CT-3 流程执行 `python <she-love-me>\scripts\diagnose_ciphertalk.py --scan-key --download-scanner`（官方无界面扫描组件，自动校验 SHA-256）。
- 找不到数据库账号目录：让用户在微信 设置→文件管理 里看存储路径，把 `<路径>\xwechat_files` 传给 check_env.mjs 的 `--wechat-root` 再跑一次。
- she-love-me 缺失：分析阶段无法进行，让用户安装 she-love-me 技能（`~/.agents/skills/she-love-me`）后再来；导出阶段仍可独立完成。

## 阶段 1：定位分片

微信 4.x 会**滚动分片**：写满 message_0.db 后新建 message_1.db，旧分片冻结、新消息全在新分片。`check_env.mjs` 已列出全部 `message_N.db`（大小/最后写入时间）。

**必须对每一个包含目标联系人 `Msg_<MD5(wxid)>` 表的分片各导一份**，然后用 merge 脚本合并。判断办法：对每个分片跑诊断（阶段 2），看「target table exists」与行数、时间范围。

注意：分片文件旁边有活跃的 `-wal` 文件（未 checkpoint 的最近若干分钟消息），本工具链按主文件解密，损失通常在分钟级，可在报告里注明数据截止时间。

## 阶段 2：诊断（验证密钥 + 看范围）

```powershell
node <skill-dir>\scripts\nt_decrypt_inspect.mjs "<message_N.db 路径>" "<对方 wxid>"
```

输出：加密参数、目标表是否存在、行数、时间范围。结尾如果报 `RangeError: Value is too large`（样例行展示撞上 BigInt 密文列）——**无害**，前面的数据已经拿到。临时目录 `%TEMP%\nt_decrypt` 由诊断脚本创建。

## 阶段 3：导出（每个分片一次）

```powershell
node <skill-dir>\scripts\nt_export.mjs "<message_N.db 路径>" "<对方 wxid>" "<我的 wxid>" "<输出.json>"
```

**参数固定 4 个，顺序不能变**：`<db> <对方wxid> <我的wxid> <输出.json>`。不要传第 5 个参数。输出为 weflow-cli 兼容 JSON，控制台自报 `exported / range / me | them` —— 用它核验发送方向合理性（比如 me 数量不该接近 0 或接近全量）。

## 阶段 4：合并

```powershell
node <skill-dir>\scripts\merge_exports.mjs "<合并输出.json>" "<分片1.json>" "<分片2.json>" [...]
```

按 createTime 排序合并、报告总量/me/them、以及 >3 天的空窗（自然空窗如春节需在报告中说明，别当数据丢失）。

## 阶段 5-10：转换 → 统计 → 采样 → 分析 → 报告

这五个阶段**委托 she-love-me 技能**执行（脚本与理论框架都是它的）：

1. 转换：`convert_weflow_cli.py --input <合并json> --contact <显示名> --contact-id <对方wxid> --own-wxid <我的wxid> --output-dir <工程>\data\contacts`
2. 统计：`stats_analyzer.py`（读返回的 bundle_dir / messages_path）
3. 采样：`build_chat_history.py --preview` → **给用户看时间范围选项，等选择** → `--since <date>`（「上次分析之后到现在」用上次的分析日期做 since）
4. 分析：读 she-love-me 的 references（analysis-framework / risk-signals / strategist-guide / report-schema）+ stats.json + chat_history.txt，按 F→A→B→C→D→E→G 写 analysis.json（无证据不诊断、双阈值预警、证据不足留 null）
5. 报告：`generate_html_report.py` → `<工程>\reports\`，最后删除 `%TEMP%\nt_decrypt`

全部命令与参数细节见本技能 `references/pipeline.md`。

## 有历史工程时

若用户已有既有分析工程（README 记录了上次的数据范围与结论）：先读它的 README，对比本次导出的行数与时间范围，把「上次分析以来」作为叙事重点，历史结论作为基线做对比（指数变化、话题是否解冻）。
