# 完整流水线参考（命令级）

本文是 SKILL.md 各阶段的命令与实战坑详解。示例变量：

- `<工程>` = 用户指定的分析工程目录（如 `D:\chat-workspace`），所有导出与分析产物放这里
- `<S>` = 本技能 scripts 目录；`<SLM>` = she-love-me 技能目录（check_env.mjs 的 `sheLoveMe.path`）
- `<PY>` = check_env.mjs 报告的 python（注意：Windows 的 `python` 可能是 Microsoft Store 占位符，优先用报告里的绝对路径，如 `E:\anaconda\python.exe`）
- `<对方wxid>` / `<我的wxid>` = 双方微信 wxid（如 `wxid_xxxxxxxx`）

## 阶段 0：预检

```powershell
node <S>\check_env.mjs
node <S>\check_env.mjs --wechat-root "E:\wechattemp\xwechat_files"   # 自动发现失败时
```

## 阶段 1-2：分片定位与诊断

微信 4.x 滚动分片判定规则（实战验证）：

- 旧分片：`message_0.db` 等，最后写入时间 **冻结** 在分片切换日
- 新分片：`message_N.db`（N 最大），`-wal` 活跃、mtime = 最近
- 分片之间数据边界干净（旧分片最大时间 < 新分片最小时间），**无重叠、无需去重**，直接拼接排序即可

对每个分片跑诊断（时间从短到长，先小分片快速验证密钥）：

```powershell
node <S>\nt_decrypt_inspect.mjs "<message_1.db>" "<对方wxid>"
node <S>\nt_decrypt_inspect.mjs "<message_0.db>" "<对方wxid>"
```

关键输出行：

- `OK pbkdf2 sha512/256000 reserve=80` → 密钥正确、解密参数确认
- `target table: Msg_<md5> | exists: true` → 该分片含此联系人（false 则跳过该分片）
- `rows: N | time range: ...` → 行数与时间范围
- 结尾 `RangeError: Value is too large to be represented as a JavaScript number` → **无害**（样例行展示撞 BigInt 密文列，前置数据已拿到）

## 阶段 3：导出（⚠️ 三大坑全在这）

```powershell
node <S>\nt_export.mjs "<db>" "<对方wxid>" "<我的wxid>" "<工程>\data\raw\p0.json"
```

**坑 1（最致命）：参数固定 4 个**。脚本内部 `myWxid = process.argv[6] || ownWxid`，任何「第 5 个参数」都会错位。旧版 README 的 5 参形式（带空串 `""`）已废弃。

**坑 2：PS 5.1 丢弃空字符串参数**。`'""'` 传给 node 后整条命令的实参**左移一位**——曾导致输出被写到以 wxid 命名的文件、后者覆盖前者的连锁事故。任何情况下都不要传 `''`。

**坑 3：输出文件名**。别用对方的 wxid 当输出文件名（坑 2 触发时它会静默变成真实输出路径）。

导出完核验控制台三行：

```
exported: NNN messages
range: ... -> ...
me: X | them: Y
```

`me` 数量应在一个合理比例（经验值 30%-60%）；`me ≈ 0` 或 `me ≈ 全量` 都说明发送方向判定坏了，先查参数顺序再重导。

## 阶段 4：合并

```powershell
node <S>\merge_exports.mjs "<工程>\data\raw\merged.json" "<工程>\data\raw\p0.json" "<工程>\data\raw\p1.json"
```

自报：各分片加载数、合并总量、me/them、>3 天空窗清单。合理空窗（春节等）要在最终报告注明。

## 阶段 5：转换

```powershell
<PY> "<SLM>\scripts\convert_weflow_cli.py" `
  --input "<工程>\data\raw\merged.json" `
  --contact "<联系人显示名>" `
  --contact-id "<对方wxid>" `
  --own-wxid "<我的wxid>" `
  --output-dir "<工程>\data\contacts"
```

返回 JSON 里的 `bundle_dir` 与 `messages_path` 是后续所有步骤的输入，**用返回值，不要猜路径**。`dropped` 应为 0 或个位数。

## 阶段 6：统计

```powershell
<PY> "<SLM>\scripts\stats_analyzer.py" --input "<messages_path>" --output "<bundle_dir>\stats.json"
```

stderr 里的 `[+] 分析完成: 主动=X 被爱=Y 冷淡=Z` 不是错误（PS 5.1 把 stderr 当错误流显示而已）。stats.json 是全量统计（频次/回复速度/语言学/三大指数/近30天），先读它再读采样。

## 阶段 7：采样范围（必须等用户）

```powershell
<PY> "<SLM>\scripts\build_chat_history.py" --input "<messages_path>" --preview
```

把选项（最近1月/3月/半年/全量，各带条数）展示给用户**并等待回复**。「上次分析之后的最新记录」用 `--since <上次分析日期>`，没有对应预设也要照此生成：

```powershell
<PY> "<SLM>\scripts\build_chat_history.py" --input "<messages_path>" --output "<bundle_dir>\chat_history.txt" --since 2026-09-02
```

## 阶段 8：AI 深度分析

依次读（都在 `<SLM>\references\`）：analysis-framework.md（F+A+B）、risk-signals.md（C，双阈值）、strategist-guide.md（D+E+G）、report-schema.md（输出 schema），再读 `<bundle_dir>\stats.json` 与 `<bundle_dir>\chat_history.txt`（注意 read 工具会截断长文件中间——分两段读全）。

执行顺序 **F → A → B → C → D → E → G**，产出按 report-schema.md 写 `<bundle_dir>\analysis.json`。铁律：无证据不诊断（每个推断锚定带时间戳的原话）、量化+文本双阈值才触发预警、证据不足输出 `{value:null, evidence_level:"insufficient", reason}` 而非硬编。

## 阶段 9：报告

```powershell
<PY> "<SLM>\scripts\generate_html_report.py" `
  --stats "<bundle_dir>\stats.json" --analysis "<bundle_dir>\analysis.json" `
  --contact "<联系人显示名>" --output "<工程>\reports\"
```

## 阶段 10：收尾

1. **删除明文解密库**：`Remove-Item $env:TEMP\nt_decrypt -Recurse -Force`（数百 MB，敏感）
2. 有历史工程时更新其 README：新数据范围、结论速览、本次修复/坑
3. 向用户展示结论摘要 + HTML 报告路径
