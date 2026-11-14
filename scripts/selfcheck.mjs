// Local gate check for the lantern entry. Not part of the graded program.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';
import { boardIssue, parseSnapshot } from '../lib/model.ts';

const root = new URL('..', import.meta.url).pathname;
const snapPath = process.argv[2] || process.env.SNAPSHOT || join(root, 'docs/input-reference/snapshot.json');
if (!existsSync(snapPath)) {
  console.error(`selfcheck: no snapshot at ${snapPath}. Pass a snapshot path. This repository does not ship one; the grader mounts /input/snapshot.json.`);
  process.exit(2);
}
const a = '/tmp/lantern-check-a';
const b = '/tmp/lantern-check-b';

function run(dir) {
  const res = spawnSync('node', ['main.ts', '--input', snapPath, '--output', dir], {
    cwd: root,
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    console.error(res.stdout);
    console.error(res.stderr);
    throw new Error(`main.ts exited ${res.status} for ${dir}`);
  }
}

function fail(msg) {
  console.error('FAIL', msg);
  process.exit(1);
}

run(a);
run(b);
const diff = spawnSync('diff', ['-rq', a, b], { encoding: 'utf8' });
if (diff.status !== 0) fail(`runs differ\n${diff.stdout}${diff.stderr}`);

const snapshot = parseSnapshot(readFileSync(snapPath, 'utf8'));
const board = JSON.parse(readFileSync(join(a, 'board.json'), 'utf8'));
const rows = board.rows;
if (!Array.isArray(rows)) fail('board.rows is not an array');
const issue = boardIssue(rows, snapshot);
if (issue) fail(issue);
const known = new Set(snapshot.protocols.map((p) => p.slug));
const seen = new Set();
const byRank = [...rows].sort((x, y) => x.rank - y.rank);
for (let i = 0; i < byRank.length; i++) {
  const r = byRank[i];
  if (r.rank !== i + 1) fail(`rank gap at ${i + 1}`);
  if (seen.has(r.slug)) fail(`duplicate ${r.slug}`);
  seen.add(r.slug);
  if (!known.has(r.slug)) fail(`unknown slug ${r.slug}`);
  if (i > 0 && r.implied_value_usd > byRank[i - 1].implied_value_usd) fail('implied value rises');
}
const missing = snapshot.watchlist.filter((s) => !seen.has(s));
if (missing.length) fail(`missing watchlist ${missing.slice(0, 5).join(',')}`);
const early = rows.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
if (early < 60) fail(`only ${early} early rows`);
if (new Set(rows.map((r) => r.implied_value_usd)).size < 2) fail('implied values are flat');

const data = readFileSync(join(a, 'data.js'), 'utf8');
if (!data.startsWith('window.RADAR=')) fail('data.js shape');
const radar = JSON.parse(data.slice('window.RADAR='.length).replace(/;\s*$/, ''));
if (radar.rows.length !== rows.length) fail('data.js row count');
for (let i = 0; i < rows.length; i++) {
  if (radar.rows[i].slug !== rows[i].slug || radar.rows[i].implied_value_usd !== rows[i].implied_value_usd) fail(`data.js diverges at ${i}`);
  if (JSON.stringify(radar.rows[i].farm_steps) !== JSON.stringify(rows[i].farm_steps)) fail(`farm steps diverge for ${rows[i].slug}`);
}

const dash = join(a, 'dashboard');
const names = readdirSync(dash);
if (!names.includes('index.html')) fail('no index.html');
if (!names.some((n) => n.endsWith('.css'))) fail('no css');
if (!names.some((n) => n.endsWith('.js'))) fail('no js');
let dashBytes = 0;
for (const name of names) {
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(name)) fail(`bad dashboard name ${name}`);
  const text = readFileSync(join(dash, name), 'utf8');
  dashBytes += Buffer.byteLength(text);
  if (text.includes('http://') || text.includes('https://')) fail(`${name} contains an http URL`);
}
if (dashBytes > 65536) fail(`dashboard source is ${dashBytes} bytes`);

const shots = readdirSync(join(a, 'screenshots')).filter((n) => !n.startsWith('.')).sort();
if (shots.length < 3 || shots.length > 4) fail(`screenshot count ${shots.length}`);
if (shots[0] !== '1-board.png') fail(`cover is ${shots[0]}`);
for (const name of shots) {
  const buf = readFileSync(join(a, 'screenshots', name));
  if (buf.length > 524288) fail(`${name} is ${buf.length} bytes`);
  const png = buf[0] === 0x89 && buf[1] === 0x50;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8;
  if (!png && !jpg) fail(`${name} is not a PNG or JPEG`);
  if (png) {
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    const long = Math.max(w, h);
    const short = Math.min(w, h);
    if (long > 1440 || short < 800) fail(`${name} is ${w}x${h}`);
  }
}

const onDisk = readFileSync(join(a, 'dossier.json'));
const fresh = Buffer.from(buildDossier(a, { text_max_bytes: 65536 }));
if (!onDisk.equals(fresh)) fail(`dossier mismatch ${onDisk.length} vs ${fresh.length}`);
if (onDisk.length > Math.floor(1.5 * 1024 * 1024)) fail(`dossier is ${onDisk.length} bytes`);

const stat = statSync(join(a, 'dossier.json'));
console.log(
  `ok rows=${rows.length} early=${early} watch=${snapshot.watchlist.length} dashboard=${dashBytes}B shots=${shots.join(',')} dossier=${stat.size}B`,
);
