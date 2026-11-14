// Lantern's value model. Implied value is built only from the snapshot's own figures.
//
//   peerMultiple  median mcap/TVL of live-token protocols in the same category,
//                 winsorized, shrunk toward the global median, then clamped
//   growthMult    1 + weight * clamp(change_7d) / 100     (missing change = flat)
//   maturityMult  Gaussian of years listed with no token recorded
//   chainMult     breadth for extra chains, times a shrunk primary-chain quality
//   implied       round(TVL * peerMultiple * growthMult * maturityMult * chainMult)
//
// Protocols that already record a market cap, a symbol, or a CoinGecko id are not
// ranked. They are the peer sample. Obvious non-launches are skipped by rule:
// CEX, bridge categories, liquid staking, liquid restaking, restaked BTC,
// version-marker names, and names that are wrapped, staked, or exchange-branded.

import { farmSteps } from './farm.ts';

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'lantern-1';

const SHRINK_K = 4;
const WINSOR_LO = 0.02;
const WINSOR_HI = 3.5;
const PEER_LO = 0.06;
const PEER_HI = 1.4;
const GROWTH_WEIGHT = 0.5;
const GROWTH_FLOOR = -40;
const GROWTH_CAP = 60;
const MATURITY_CENTER = 1.25;
const MATURITY_SIGMA = 0.9;
const MATURITY_FLOOR = 0.72;
const MATURITY_PEAK = 0.46;
const MATURITY_UNKNOWN = 0.88;
const CHAIN_SHRINK_K = 8;

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAP_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const DAY_MS = 86_400_000;

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  primary_chain: string;
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  cohort: 'watchlist' | 'early';
  token_status: 'pre-token';
  implied_value_usd: number;
  peer_multiple: number;
  peer_raw: number | null;
  peer_n: number;
  growth_pct: number;
  growth_missing: boolean;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_breadth: number;
  chain_quality: number;
  chain_multiplier: number;
  combined: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  symbol: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  multiple: number;
}

export interface CategoryPeer {
  category: string;
  peers: number;
  raw_median: number;
  multiple: number;
}

export interface SkipCounts {
  total: number;
  cex: number;
  bridge: number;
  liquid_staking: number;
  liquid_restaking: number;
  restaked_btc: number;
  versioned: number;
  wrapped_or_staked_name: number;
  exchange_name: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: {
    version: string;
    shrink_k: number;
    winsor_lo: number;
    winsor_hi: number;
    peer_lo: number;
    peer_hi: number;
    growth_weight: number;
    growth_floor: number;
    growth_cap: number;
    maturity_center_years: number;
    maturity_sigma_years: number;
    maturity_floor: number;
    maturity_peak: number;
    maturity_unknown: number;
    global_multiple: number;
    peer_protocols: number;
    formula: string;
  };
  categories: CategoryPeer[];
  skipped: SkipCounts;
  token_recorded: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function median(values: number[]): number {
  const a = [...values].sort((x, y) => x - y);
  const n = a.length;
  const m = n >> 1;
  if (n % 2 === 1) return a[m]!;
  return (a[m - 1]! + a[m]!) / 2;
}

function shrink(n: number, raw: number, global: number, k: number): number {
  const w = n / (n + k);
  return w * raw + (1 - w) * global;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol records no token when market cap, CoinGecko id, and symbol are all absent. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

function bridgeCategory(category: string | null): boolean {
  return category !== null && /\bbridge\b/i.test(category);
}

/** Why a pre-token protocol is not a launch candidate, or null when it is one. */
function skipReason(p: SnapshotProtocol): keyof Omit<SkipCounts, 'total'> | null {
  if (p.category === 'CEX') return 'cex';
  if (bridgeCategory(p.category)) return 'bridge';
  if (p.category === 'Liquid Staking') return 'liquid_staking';
  if (p.category === 'Liquid Restaking') return 'liquid_restaking';
  if (p.category === 'Restaked BTC') return 'restaked_btc';
  if (VERSIONED.test(p.name)) return 'versioned';
  if (WRAP_WORD.test(p.name)) return 'wrapped_or_staked_name';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange_name';
  return null;
}

function isWrapperPeer(category: string | null): boolean {
  return category === 'CEX' || category === 'Liquid Staking' || category === 'Liquid Restaking' || category === 'Restaked BTC' || bridgeCategory(category);
}

/** Live peers that can price a multiple: a positive market cap, and not a wrapper book. */
function isPricingPeer(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && !isWrapperPeer(p.category);
}

function winsor(ratio: number): number {
  return clamp(ratio, WINSOR_LO, WINSOR_HI);
}

export function maturityMultiplier(age: number | null): number {
  if (age === null) return MATURITY_UNKNOWN;
  const years = age / 365;
  const z = (years - MATURITY_CENTER) / MATURITY_SIGMA;
  return round4(MATURITY_FLOOR + MATURITY_PEAK * Math.exp(-0.5 * z * z));
}

export function growthMultiplier(change: number | null): { pct: number; mult: number; missing: boolean } {
  if (change === null || !Number.isFinite(change)) return { pct: 0, mult: 1, missing: true };
  const pct = round4(clamp(change, GROWTH_FLOOR, GROWTH_CAP));
  return { pct, mult: round4(1 + (pct / 100) * GROWTH_WEIGHT), missing: false };
}

/** The implied dollar value from factors that have already been rounded. */
export function impliedFromFactors(tvl: number, peer: number, growth: number, maturity: number, chain: number): number {
  const n = Math.round(tvl * peer * growth * maturity * chain);
  if (n < 1) return 1;
  if (n > 100_000_000_000_000) return 100_000_000_000_000;
  return n;
}

interface PeerModel {
  global: number;
  peerN: number;
  byCategory: Map<string, { n: number; raw: number; multiple: number }>;
  byChain: Map<string, { n: number; raw: number }>;
  categories: CategoryPeer[];
}

function buildPeers(protocols: SnapshotProtocol[]): PeerModel {
  const peers = protocols.filter(isPricingPeer);
  const ratios = peers.map((p) => winsor(p.mcap_usd! / p.tvl_usd));
  const global = ratios.length > 0 ? round4(median(ratios)) : 0.25;

  const grouped = new Map<string, number[]>();
  const chained = new Map<string, number[]>();
  for (let i = 0; i < peers.length; i++) {
    const p = peers[i]!;
    const cat = p.category ?? 'Uncategorized';
    const ratio = ratios[i]!;
    const list = grouped.get(cat);
    if (list) list.push(ratio);
    else grouped.set(cat, [ratio]);
    const primary = p.chains[0];
    if (primary) {
      const cl = chained.get(primary);
      if (cl) cl.push(ratio);
      else chained.set(primary, [ratio]);
    }
  }

  const byCategory = new Map<string, { n: number; raw: number; multiple: number }>();
  const categories: CategoryPeer[] = [];
  for (const [category, list] of grouped) {
    const raw = round4(median(list));
    const multiple = round4(clamp(shrink(list.length, raw, global, SHRINK_K), PEER_LO, PEER_HI));
    byCategory.set(category, { n: list.length, raw, multiple });
    categories.push({ category, peers: list.length, raw_median: raw, multiple });
  }
  categories.sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));

  const byChain = new Map<string, { n: number; raw: number }>();
  for (const [chain, list] of chained) byChain.set(chain, { n: list.length, raw: round4(median(list)) });

  return { global, peerN: peers.length, byCategory, byChain, categories };
}

function chainFactor(chains: string[], peers: PeerModel): { breadth: number; quality: number; mult: number; primary: string } {
  const primary = chains[0] ?? '';
  const extra = Math.min(5, Math.max(0, chains.length - 1));
  const breadth = round4(1 + 0.02 * extra);
  let quality = 1;
  const st = primary ? peers.byChain.get(primary) : undefined;
  if (st && st.n >= 4 && peers.global > 0) {
    const shrunk = shrink(st.n, st.raw, peers.global, CHAIN_SHRINK_K);
    quality = round4(clamp(shrunk / peers.global, 0.94, 1.08));
  }
  const mult = round4(clamp(breadth * quality, 0.9, 1.16));
  return { breadth, quality, mult, primary: primary || 'unspecified' };
}

function peerFactor(category: string | null, peers: PeerModel): { multiple: number; raw: number | null; n: number } {
  const key = category ?? 'Uncategorized';
  const hit = peers.byCategory.get(key);
  if (!hit) return { multiple: peers.global, raw: null, n: 0 };
  return { multiple: hit.multiple, raw: hit.raw, n: hit.n };
}

export function buildBoard(snapshot: Snapshot): { rows: BoardRow[]; peers: PeerModel; skipped: SkipCounts; tokenRecorded: number } {
  const watch = new Set(snapshot.watchlist);
  const peers = buildPeers(snapshot.protocols);
  const skipped: SkipCounts = {
    total: 0,
    cex: 0,
    bridge: 0,
    liquid_staking: 0,
    liquid_restaking: 0,
    restaked_btc: 0,
    versioned: 0,
    wrapped_or_staked_name: 0,
    exchange_name: 0,
  };
  let tokenRecorded = 0;
  const chosen: SnapshotProtocol[] = [];

  for (const p of snapshot.protocols) {
    if (!recordsNoToken(p)) {
      tokenRecorded += 1;
      continue;
    }
    const reason = skipReason(p);
    if (reason !== null && !watch.has(p.slug)) {
      skipped[reason] += 1;
      skipped.total += 1;
      continue;
    }
    if (reason === null || watch.has(p.slug)) chosen.push(p);
  }

  // A watchlist slug has to be present even if the loop above missed it.
  const have = new Set(chosen.map((p) => p.slug));
  for (const slug of snapshot.watchlist) {
    if (have.has(slug)) continue;
    const p = snapshot.protocols.find((x) => x.slug === slug);
    if (p) chosen.push(p);
  }

  const scored = chosen.map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const growth = growthMultiplier(p.change_7d);
    const maturity = maturityMultiplier(age);
    const peer = peerFactor(p.category, peers);
    const chain = chainFactor(p.chains, peers);
    const implied = impliedFromFactors(p.tvl_usd, peer.multiple, growth.mult, maturity, chain.mult);
    const combined = round4(peer.multiple * growth.mult * maturity * chain.mult);
    const row: BoardRow = {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      primary_chain: chain.primary,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: age,
      cohort: watch.has(p.slug) ? 'watchlist' : 'early',
      token_status: 'pre-token',
      implied_value_usd: implied,
      peer_multiple: peer.multiple,
      peer_raw: peer.raw,
      peer_n: peer.n,
      growth_pct: growth.pct,
      growth_missing: growth.missing,
      growth_multiplier: growth.mult,
      maturity_multiplier: maturity,
      chain_breadth: chain.breadth,
      chain_quality: chain.quality,
      chain_multiplier: chain.mult,
      combined,
      farm_steps: farmSteps({
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        age_days: age,
      }),
    };
    return row;
  });

  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (let i = 0; i < scored.length; i++) scored[i]!.rank = i + 1;
  return { rows: scored, peers, skipped, tokenRecorded };
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      symbol: p.symbol,
      chains: p.chains.slice(0, 4),
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      multiple: round4(p.mcap_usd! / p.tvl_usd),
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { rows, peers, skipped, tokenRecorded } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const early = rows.filter((r) => r.cohort === 'early').length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: {
      version: MODEL_VERSION,
      shrink_k: SHRINK_K,
      winsor_lo: WINSOR_LO,
      winsor_hi: WINSOR_HI,
      peer_lo: PEER_LO,
      peer_hi: PEER_HI,
      growth_weight: GROWTH_WEIGHT,
      growth_floor: GROWTH_FLOOR,
      growth_cap: GROWTH_CAP,
      maturity_center_years: MATURITY_CENTER,
      maturity_sigma_years: MATURITY_SIGMA,
      maturity_floor: MATURITY_FLOOR,
      maturity_peak: MATURITY_PEAK,
      maturity_unknown: MATURITY_UNKNOWN,
      global_multiple: peers.global,
      peer_protocols: peers.peerN,
      formula: 'implied = round(TVL * peerMultiple * growthMult * maturityMult * chainMult)',
    },
    categories: peers.categories,
    skipped,
    token_recorded: tokenRecorded,
    watchlist_size: snapshot.watchlist.length,
    board_size: rows.length,
    early_size: early,
    rows,
    live,
  };
  return { board: rows, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string' || o.source.length === 0) throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist');

  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || p.slug.length === 0 || /\s/.test(p.slug)) throw new SnapshotError(`protocol ${i} has a bad slug`);
    if (typeof p.name !== 'string' || p.name.trim().length === 0) throw new SnapshotError(`protocol ${i} has no name`);
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) throw new SnapshotError(`protocol ${i} has no TVL`);
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });

  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** A gate failure, or null when the board is one the scorer can accept. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set<string>();
  const ranks: number[] = [];
  for (const r of board) {
    if (typeof r.slug !== 'string' || r.slug.length < 1 || r.slug.length > 128 || /\s/.test(r.slug)) return `bad slug ${r.slug}`;
    if (!known.has(r.slug)) return `slug ${r.slug} is not in the snapshot`;
    if (slugs.has(r.slug)) return `duplicate slug ${r.slug}`;
    slugs.add(r.slug);
    if (typeof r.name !== 'string' || r.name.trim().length === 0) return `${r.slug} has no name`;
    if (!Number.isSafeInteger(r.rank) || r.rank <= 0) return `${r.slug} has rank ${r.rank}`;
    ranks.push(r.rank);
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps?.length ?? 0} farm steps`;
    for (const s of r.farm_steps) {
      if (typeof s !== 'string') return `${r.slug} has a non-string farm step`;
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    const again = impliedFromFactors(r.tvl_usd, r.peer_multiple, r.growth_multiplier, r.maturity_multiplier, r.chain_multiplier);
    if (again !== r.implied_value_usd) return `${r.slug} implied ${r.implied_value_usd} does not match factors (${again})`;
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `missing watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  if (early < 60) return `only ${early} rows outside the watchlist`;
  ranks.sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `ranks are not 1..N (at ${i + 1} found ${ranks[i]})`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${byRank[i]!.rank} outranks rank ${byRank[i - 1]!.rank}`;
  }
  if (byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'every row has the same implied value';
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
