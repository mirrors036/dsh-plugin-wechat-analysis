#!/usr/bin/env node
// check_env.mjs — 微信聊天分析流水线环境预检（wechat-chat-analysis 技能专用）。
// 用法: node check_env.mjs [--wechat-root "<xwechat_files 目录>"]
// 输出: JSON（不含密钥明文与聊天内容）。exit code 0 恒定，缺项看 result 字段。

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
let rootOverride = null;
{
  const i = argv.indexOf('--wechat-root');
  if (i >= 0 && argv[i + 1]) rootOverride = argv[i + 1];
}

const report = { ok: true, problems: [], hints: [] };

// ---------- 1) node + node:sqlite ----------
const node = { version: process.versions.node, sqlite: false };
try {
  await import('node:sqlite');
  node.sqlite = true;
} catch (e) {
  node.error = String(e?.message ?? e);
}
if (!node.sqlite) {
  report.ok = false;
  report.problems.push('node:sqlite 不可用（需 Node ≥22.19 且非 --no-experimental-sqlite 启动）');
}
report.node = node;

// ---------- 2) 数据库密钥（只报有无，不报值） ----------
const key = {};
const agentsHome = process.env.DSH_AGENTS_HOME || join(homedir(), '.agents');
const miyuPath = join(homedir(), '.miyu', 'config.json');
key.configPath = miyuPath;
if (existsSync(miyuPath)) {
  try {
    const j = JSON.parse(readFileSync(miyuPath, 'utf8'));
    key.hasKeyHex = typeof j.keyHex === 'string' && j.keyHex.length === 64;
    key.keyHexLength = typeof j.keyHex === 'string' ? j.keyHex.length : 0;
  } catch {
    key.hasKeyHex = false;
    key.error = '~/.miyu/config.json 解析失败';
  }
} else {
  key.hasKeyHex = false;
}
if (!key.hasKeyHex) {
  report.problems.push('数据库密钥缺失（~/.miyu/config.json 无 keyHex）。按 she-love-me data-sources.md CT-3: python <she-love-me>/scripts/diagnose_ciphertalk.py --scan-key --download-scanner');
}
report.key = key;

// ---------- 3) 微信数据库（账号 + 全部分片） ----------
const DEFAULT_ROOTS = [
  'E:\\wechattemp\\xwechat_files',
  join(homedir(), 'Documents', 'xwechat_files'),
  'D:\\xwechat_files',
  'D:\\WeChat Files\\xwechat_files',
  'C:\\xwechat_files',
];
const roots = [];
for (const r of (rootOverride ? [rootOverride] : DEFAULT_ROOTS)) {
  if (existsSync(r)) roots.push(r);
}
if (rootOverride && !existsSync(rootOverride)) {
  report.problems.push(`--wechat-root 指定的目录不存在: ${rootOverride}`);
}
if (!roots.length) {
  report.ok = false;
  report.problems.push('未找到 xwechat_files 目录。让用户在微信 设置→文件管理 查看存储位置，把其中的 xwechat_files 路径用 --wechat-root 传入');
}

const accounts = [];
for (const r of roots) {
  let entries = [];
  try { entries = readdirSync(r, { withFileTypes: true }); } catch { continue; }
  for (const ent of entries) {
    if (!ent.isDirectory() || !ent.name.startsWith('wxid_')) continue;
    const msgDir = join(r, ent.name, 'db_storage', 'message');
    if (!existsSync(msgDir)) continue;
    const shards = [];
    const walActive = [];
    try {
      for (const f of readdirSync(msgDir)) {
        const m = /^message_(\d+)\.db$/.exec(f);
        if (m) {
          const st = statSync(join(msgDir, f));
          shards.push({
            shard: Number(m[1]),
            file: f,
            path: join(msgDir, f),
            sizeMB: Math.round(st.size / 104857.6) / 10,
            lastWrite: st.mtime.toISOString(),
          });
        } else if (/^message_\d+\.db-wal$/.test(f)) {
          walActive.push(f);
        }
      }
    } catch { /* 权限问题则跳过该账号 */ }
    shards.sort((a, b) => a.shard - b.shard);
    if (shards.length) accounts.push({ account: ent.name, messageDir: msgDir, shards, activeWal: walActive });
  }
}
if (!accounts.length && roots.length) {
  report.problems.push('找到了 xwechat_files 但没有含 message_N.db 的账号目录（微信未在本机落库？）');
}
report.wechat = { roots, accounts, note: '微信 4.x 会滚动分片：新消息在最新分片，历史在旧分片；需对每个含目标联系人的分片各导一份再合并' };

// ---------- 4) she-love-me 技能（分析阶段依赖） ----------
const SLM_MARKERS = ['scripts/stats_analyzer.py', 'scripts/convert_weflow_cli.py', 'references/analysis-framework.md'];
const slmCandidates = [
  join(agentsHome, 'skills', 'she-love-me'),
  join(process.cwd(), '.agents', 'skills', 'she-love-me'),
  join(homedir(), '.config', 'opencode', 'skills', 'she-love-me'),
];
let slm = { found: false, candidates: slmCandidates };
for (const c of slmCandidates) {
  if (SLM_MARKERS.every((k) => existsSync(join(c, k)))) {
    slm = { found: true, path: c, complete: true };
    break;
  } else if (existsSync(c)) {
    slm = { found: true, path: c, complete: false, missing: SLM_MARKERS.filter((k) => !existsSync(join(c, k))) };
  }
}
if (!slm.found) {
  report.ok = false;
  report.problems.push('未找到 she-love-me 技能（分析阶段 5-10 依赖它）。装到 ~/.agents/skills/she-love-me 后重跑；导出阶段（0-4）可独立使用');
}
report.sheLoveMe = slm;

// ---------- 5) python ----------
const pythons = [];
const PY_CANDIDATES = [
  ['python', ['--version']],
  ['python3', ['--version']],
  ['py', ['-3', '--version']],
  ['E:\\anaconda\\python.exe', ['--version']],
];
for (const [cmd, args] of PY_CANDIDATES) {
  try {
    const v = execFileSync(cmd, args, { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).toString().trim();
    pythons.push({ cmd, version: v });
  } catch { /* 不在就不列 */ }
}
if (!pythons.length) {
  report.ok = false;
  report.problems.push('未找到可用的 python（分析阶段需要 ≥3.9）');
}
report.python = pythons;

console.log(JSON.stringify(report, null, 2));
