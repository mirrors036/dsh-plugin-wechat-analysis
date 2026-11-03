// merge_exports.mjs - merge multiple nt_export.mjs outputs into one weflow-cli
// compatible JSON array, sorted by createTime (then localId).
// usage: node merge_exports.mjs <out.json> <in1.json> <in2.json> [...]
import { readFileSync, writeFileSync } from 'fs';

const [outPath, ...inputs] = process.argv.slice(2);
if (!outPath || inputs.length < 2) {
  console.error('usage: node merge_exports.mjs <out.json> <in1.json> <in2.json> [...]');
  process.exit(1);
}

const all = [];
for (const f of inputs) {
  const arr = JSON.parse(readFileSync(f, 'utf8'));
  if (!Array.isArray(arr)) { console.error('not an array:', f); process.exit(1); }
  for (const m of arr) all.push(m);
  console.log('loaded', arr.length, 'from', f);
}
all.sort((a, b) => a.createTime - b.createTime || (a.localId - b.localId));

// sanity: report boundary gaps larger than 3 days (should be none)
let lastT = 0;
const gaps = [];
for (const m of all) {
  if (lastT && m.createTime - lastT > 3 * 86400) {
    gaps.push(new Date(lastT * 1000).toISOString() + ' -> ' + new Date(m.createTime * 1000).toISOString());
  }
  lastT = m.createTime;
}

writeFileSync(outPath, JSON.stringify(all), 'utf8');
const first = all[0], last = all[all.length - 1];
console.log('merged total:', all.length);
console.log('range:', new Date(first.createTime * 1000).toISOString(), '->', new Date(last.createTime * 1000).toISOString());
const mine = all.filter(m => m.isSend === 1).length;
console.log('me:', mine, '| them:', all.length - mine);
if (gaps.length) { console.log('gaps > 3 days:', gaps.length); gaps.slice(0, 5).forEach(g => console.log('  ' + g)); }
else console.log('no gaps > 3 days');
