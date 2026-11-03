// dsh-plugin-wechat-analysis 服务端入口。
//
// 职责单一：DSH 启动加载本插件时，把包内 skills/wechat-chat-analysis 以目录联接
// （junction）挂到用户技能目录（$DSH_AGENTS_HOME/skills，默认 ~/.agents/skills），
// 使该技能进入每个会话的可用技能目录。
//
// 幂等与安全：
//   - 目标已是本包技能目录的联接 → 跳过（already-linked）；
//   - 目标是真实目录或指向其它位置的联接 → 不动、只告警（绝不覆盖用户自己的同名技能）；
//   - 目标不存在 → 创建 junction。
//
// 卸载说明：pnpm remove 删除包不会触发本入口的清理，可能残留悬空联接；
// 技能扫描器会跳过失效目录，如需手动清理：
//   (Get-Item ~/.agents/skills/wechat-chat-analysis).Delete()

import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';

export const name = 'dsh-plugin-wechat-analysis';

const SKILL_NAME = 'wechat-chat-analysis';

function pkgDir() {
  // import.meta.url = <pkg>/lib/index.js → 上两级即包根
  return fileURLToPath(new URL('..', import.meta.url));
}

function agentsSkillsRoot() {
  const agentsHome = process.env.DSH_AGENTS_HOME || join(homedir(), '.agents');
  return join(agentsHome, 'skills');
}

function samePath(a, b) {
  if (!a || !b) return false;
  const na = isAbsolute(a) ? a : null;
  const nb = isAbsolute(b) ? b : null;
  if (!na || !nb) return false;
  return na.toLowerCase().replace(/[\\/]+$/, '') === nb.toLowerCase().replace(/[\\/]+$/, '');
}

function ensureSkillLinked() {
  const source = join(pkgDir(), 'skills', SKILL_NAME);
  if (!existsSync(source)) {
    return { ok: false, reason: `包内技能目录缺失: ${source}` };
  }
  const root = agentsSkillsRoot();
  const target = join(root, SKILL_NAME);

  let st = null;
  try { st = lstatSync(target); } catch { /* 目标不存在 */ }

  if (st) {
    if (st.isSymbolicLink()) {
      let cur = null;
      try { cur = readlinkSync(target); } catch { /* 读取失败按未知处理 */ }
      const curAbs = cur && !isAbsolute(cur) ? resolve(dirname(target), cur) : cur;
      if (samePath(curAbs, source)) return { ok: true, action: 'already-linked' };
      return { ok: false, reason: `~/.agents/skills/${SKILL_NAME} 已指向其它位置，跳过（不覆盖）` };
    }
    return { ok: false, reason: `~/.agents/skills/${SKILL_NAME} 已存在同名目录，跳过（不覆盖）` };
  }

  mkdirSync(root, { recursive: true });
  try {
    symlinkSync(source, target, 'junction');
  } catch (err) {
    return { ok: false, reason: `创建 junction 失败: ${err?.message ?? err}` };
  }
  return { ok: true, action: 'linked' };
}

export function apply(ctx, config = {}) {
  const logger = ctx?.logger ?? console;
  try {
    const r = ensureSkillLinked();
    if (r.ok) {
      logger.info?.(`wechat-chat-analysis: skill ${r.action} -> ${agentsSkillsRoot()}`);
    } else {
      logger.warn?.(`wechat-chat-analysis: ${r.reason}`);
    }
  } catch (err) {
    logger.error?.(`wechat-chat-analysis: 挂载技能失败: ${err?.message ?? err}`);
  }
}
