// Lantern: a token-launch radar. Node 22, standard library only.
//
// Reads the sealed snapshot, ranks pre-token protocols by an implied value built from
// live-token peer multiples, and writes the board, the dashboard data, a copy of
// dashboard/ and screenshots/, and dossier.json last.
//
//   node main.ts
//   node main.ts --input docs/input-reference/snapshot.json --output out

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, SnapshotError } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const flag = `--${name}`;
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i]!;
    if (a === flag && i + 1 < process.argv.length) return process.argv[i + 1]!;
    if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1);
  }
  return fallback;
}

function resolveInput(): string {
  const explicit = arg('input', '');
  if (explicit) return explicit.endsWith('.json') ? explicit : join(explicit, 'snapshot.json');
  if (existsSync('/input/snapshot.json')) return '/input/snapshot.json';
  return join(here, 'docs', 'input-reference', 'snapshot.json');
}

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  copied.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return copied;
}

const inputFile = resolveInput();
if (!existsSync(inputFile)) {
  process.stderr.write(`lantern: no snapshot at ${inputFile}. Pass --input <snapshot.json|directory>, or mount /input/snapshot.json.\n`);
  process.exit(2);
}

const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

let snapshot;
try {
  snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
} catch (err) {
  const message = err instanceof SnapshotError ? err.message : err instanceof Error ? err.message : String(err);
  process.stderr.write(`lantern: ${message}\n`);
  process.exit(1);
}

let board;
let radar;
try {
  const built = buildRadar(snapshot);
  board = built.board;
  radar = built.radar;
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`lantern: ${message}\n`);
  process.exit(1);
}

const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`lantern: the board fails the gate: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`lantern: screenshots/ has ${shots.length} images; need 3 or 4 (the board, a detail view, a filtered view).\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`lantern: screenshots/${name} must be letters, digits, and . _ -, 1 to 128 characters.\n`);
    process.exit(1);
  }
}

try {
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, {
      text_max_bytes: TEXT_MAX_BYTES,
      screenshots: SCREENSHOT_CAPS,
      dashboard: { max_files: 400, max_bytes: 4_194_304 },
    }),
  );
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`lantern: ${message}\n`);
  process.exit(1);
}

process.stdout.write(
  `lantern: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} ranked (${radar.early_size} early, ${radar.token_recorded} with a recorded token set aside, ${radar.skipped.total} pre-token skipped by rule)\n` +
    `lantern: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, dashboard (${dashFiles.length} files), screenshots (${shots.length}), ${join(out, 'dossier.json')}\n`,
);
