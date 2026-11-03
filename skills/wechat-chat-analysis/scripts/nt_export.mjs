import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { createDecipheriv, pbkdf2Sync, createHash } from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { homedir, tmpdir } from 'os';
import { join, dirname } from 'path';

const [dbPath, username, ownWxid, outPath] = process.argv.slice(2);
if (!dbPath || !username || !outPath) {
  console.error('usage: node nt_export.mjs <message_0.db> <contact wxid> <own wxid> <out.json> [own-wxid]');
  process.exit(1);
}
const myWxid = process.argv[6] || ownWxid;

const keyHex = JSON.parse(readFileSync(join(homedir(), '.miyu', 'config.json'), 'utf8')).keyHex;
const PAGE_SIZE = 4096;
const SQLITE_HEADER = Buffer.from('SQLite format 3\x00');

function decryptTo(dbPath, tempName) {
  const blist = readFileSync(dbPath);
  const salt = blist.subarray(0, 16);
  const rawKey = Buffer.from(keyHex, 'hex');
  const pageKey = pbkdf2Sync(rawKey, salt, 256000, 32, 'sha512');
  const reserve = 80;
  const out = [SQLITE_HEADER];
  for (let i = 0; i < blist.length; i += PAGE_SIZE) {
    const page = blist.subarray(i, Math.min(i + PAGE_SIZE, blist.length));
    if (page.length === 0) continue;
    if (i === 0) {
      const encLen = page.length - 16 - reserve;
      const enc = page.subarray(16, 16 + encLen);
      const reserved = page.subarray(16 + encLen);
      const d = createDecipheriv('aes-256-cbc', pageKey, reserved.subarray(0, 16));
      d.setAutoPadding(false);
      out.push(Buffer.concat([d.update(enc), d.final()]), reserved);
    } else {
      const encLen = page.length - reserve;
      const enc = page.subarray(0, encLen);
      const reserved = page.subarray(encLen);
      const d = createDecipheriv('aes-256-cbc', pageKey, reserved.subarray(0, 16));
      d.setAutoPadding(false);
      out.push(Buffer.concat([d.update(enc), d.final()]), reserved);
    }
  }
  const t = join(tmpdir(), 'nt_decrypt', tempName);
  writeFileSync(t, Buffer.concat(out));
  return t;
}

const msgTemp = decryptTo(dbPath, 'message_0.full.db');
const db = new DatabaseSync(msgTemp);

// sender id (rowid in Name2Id) -> username map
const nameRows = db.prepare('SELECT rowid, user_name FROM Name2Id').all();
const id2name = new Map(nameRows.map(r => [Number(r.rowid), r.user_name]));
const mySenderId = [...id2name.entries()].filter(([, n]) => n === myWxid).map(([id]) => id);
const contactSenderId = [...id2name.entries()].filter(([, n]) => n === username).map(([id]) => id);
console.log('my sender ids:', JSON.stringify(mySenderId), '| contact sender ids:', JSON.stringify(contactSenderId));

const tbl = 'Msg_' + createHash('md5').update(username).digest('hex');
const cnt = db.prepare(`SELECT count(*) AS n FROM "${tbl}"`).get();
console.log('total rows in target table:', cnt.n);

const stmt = db.prepare(`
  SELECT local_id, local_type, sort_seq, real_sender_id, create_time, message_content
  FROM "${tbl}" ORDER BY sort_seq ASC
`);
const messages = [];
for (const row of stmt.all()) {
  const senderId = Number(row.real_sender_id);
  const senderName = id2name.get(senderId) || '';
  const isSend = mySenderId.includes(senderId) ? 1 : contactSenderId.includes(senderId) ? 0 : (senderName ? 0 : 1);
  let content = row.message_content;
  if (Buffer.isBuffer(content)) content = content.length ? '' : '';
  if (typeof content !== 'string') content = String(content ?? '');
  messages.push({
    localId: Number(row.local_id),
    isSend,
    localType: Number(row.local_type),
    createTime: Number(row.create_time),
    senderUsername: senderName,
    content: content || '',
  });
}
db.close();

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(messages), 'utf8');
const first = messages[0], last = messages[messages.length - 1];
console.log('exported:', messages.length, 'messages');
console.log('range:', new Date(first.createTime * 1000).toISOString(), '->', new Date(last.createTime * 1000).toISOString());
const mine = messages.filter(m => m.isSend === 1).length;
console.log('me:', mine, '| them:', messages.length - mine);
