import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { createDecipheriv, pbkdf2Sync } from 'crypto';
import { createHash } from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { homedir, tmpdir } from 'os';
import { join, basename } from 'path';

const PAGE_SIZE = 4096;
const SQLITE_HEADER = Buffer.from('SQLite format 3\x00');

const dbPath = process.argv[2];
const username = process.argv[3] || '';
const keyHex = JSON.parse(readFileSync(join(homedir(), '.miyu', 'config.json'), 'utf8')).keyHex;
if (!keyHex || keyHex.length !== 64) { console.error('bad key'); process.exit(1); }

function decryptPages(blist, pageKey, reserveLen) {
  const out = [SQLITE_HEADER];
  for (let i = 0; i < blist.length; i += PAGE_SIZE) {
    const page = blist.subarray(i, Math.min(i + PAGE_SIZE, blist.length));
    if (page.length === 0) continue;
    if (i === 0) {
      const encLen = page.length - 16 - reserveLen;
      if (encLen <= 0) { out.push(page.subarray(16)); continue; }
      const enc = page.subarray(16, 16 + encLen);
      const reserved = page.subarray(16 + encLen);
      const iv = reserved.subarray(0, 16);
      const d = createDecipheriv('aes-256-cbc', pageKey, iv);
      d.setAutoPadding(false);
      out.push(Buffer.concat([d.update(enc), d.final()]), reserved);
    } else {
      const encLen = page.length - reserveLen;
      if (encLen <= 0) { out.push(page); continue; }
      const enc = page.subarray(0, encLen);
      const reserved = page.subarray(encLen);
      const iv = reserved.subarray(0, 16);
      const d = createDecipheriv('aes-256-cbc', pageKey, iv);
      d.setAutoPadding(false);
      out.push(Buffer.concat([d.update(enc), d.final()]), reserved);
    }
  }
  return Buffer.concat(out);
}

const blist = readFileSync(dbPath);
const salt = blist.subarray(0, 16);
const rawKey = Buffer.from(keyHex, 'hex');

const tmpDir = join(tmpdir(), 'nt_decrypt');
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

let success = false;
let tempPath = '';
const attempts = [];
for (const cfg of [
  { sha: 'sha512', iters: 256000, reserve: 80 },
  { sha: 'sha512', iters: 256000, reserve: 48 },
  { sha: 'sha1', iters: 64000, reserve: 48 },
  { sha: 'sha512', iters: 64000, reserve: 80 },
]) {
  const pageKey = pbkdf2Sync(rawKey, salt, cfg.iters, 32, cfg.sha);
  for (const reserve of [cfg.reserve]) {
    const t = join(tmpDir, basename(dbPath) + `.p${cfg.sha}${cfg.iters}r${reserve}.decrypted.db`);
    try {
      const dec = decryptPages(blist, pageKey, reserve);
      writeFileSync(t, dec);
      const db = new DatabaseSync(t);
      const r = db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
      if (r && r.n > 0) {
        console.log(`OK pbkdf2 ${cfg.sha}/${cfg.iters} reserve=${reserve} tables=${r.n}`);
        success = true; tempPath = t;
        db.close();
        break;
      }
      db.close();
      attempts.push(`${cfg.sha}/${cfg.iters}/r${reserve}: not a db`);
    } catch (e) {
      attempts.push(`${cfg.sha}/${cfg.iters}/r${reserve}: ${e.message}`);
    }
  }
  if (success) break;
}
if (!success) {
  console.log(attempts.join('\n'));
  for (const reserve of [48, 80]) {
    const t = join(tmpDir, basename(dbPath) + `.r${reserve}.decrypted.db`);
    try {
      const dec = decryptPages(blist, rawKey, reserve);
      writeFileSync(t, dec);
      const db = new DatabaseSync(t);
      const r = db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
      if (r && r.n > 0) {
        console.log(`OK raw reserve=${reserve} tables=${r.n}`);
        success = true; tempPath = t;
        db.close();
        break;
      }
      db.close();
    } catch (e) {
      attempts.push(`raw/r${reserve}: ${e.message}`);
    }
  }
}
if (!success) { console.error('DECRYPT FAILED with raw key'); process.exit(2); }

const db = new DatabaseSync(tempPath);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
console.log('total tables:', tables.length);

if (username) {
  const tbl = 'Msg_' + createHash('md5').update(username).digest('hex');
  console.log('target table:', tbl, '| exists:', tables.includes(tbl));
  if (tables.includes(tbl)) {
    const cnt = db.prepare(`SELECT count(*) AS n FROM "${tbl}"`).get();
    const rng = db.prepare(`SELECT MIN(create_time) AS a, MAX(create_time) AS b FROM "${tbl}"`).get();
    console.log('rows:', cnt.n, '| time range:', new Date(rng.a * 1000).toISOString(), '->', new Date(rng.b * 1000).toISOString());
    const cols = db.prepare(`PRAGMA table_info("${tbl}")`).all().map(c => c.name);
    console.log('columns:', cols.join(','));
    const sample = db.prepare(`SELECT * FROM "${tbl}" ORDER BY create_time ASC LIMIT 2`).all();
    console.log('sample first 2:', JSON.stringify(sample).slice(0, 600));
  }
} else {
  console.log('tables sample:', tables.slice(0, 40).join(', '));
  if (tables.includes('Name2Id')) {
    const n = db.prepare('SELECT count(*) AS n FROM Name2Id WHERE is_session=1').get();
    console.log('sessions in Name2Id:', n.n);
  }
}
db.close();
