// Farm plans for one pre-token protocol. Every step names the protocol, a chain, a dollar
// cost, and a duration. The wording follows the category, the chains, the TVL, and the age.
// No protocol is special-cased by name.

export interface FarmInput {
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
}

type Family =
  | 'credit'
  | 'dex'
  | 'deriv'
  | 'predict'
  | 'rwa'
  | 'insure'
  | 'stake'
  | 'vault'
  | 'pay'
  | 'chain'
  | 'stable'
  | 'index'
  | 'btc';

const CHEAP = new Set(['solana', 'sui', 'aptos', 'ton', 'near', 'sei', 'starknet', 'tron']);
const L2 = new Set([
  'base', 'arbitrum', 'optimism', 'polygon', 'scroll', 'blast', 'linea', 'mantle', 'zksync era',
  'ink', 'unichain', 'mode', 'manta', 'taiko', 'fraxtal', 'metis', 'bob', 'celo', 'gnosis',
  'avalanche', 'katana', 'monad', 'corn', 'arc', 'robinhood chain', 'hyperliquid l1', 'opbnb',
  'zora', 'boba', 'fantom', 'cronos', 'aurora', 'moonbeam', 'kava', 'harmony', 'polygon zkevm',
  'arbitrum nova', 'manta pacific', 'scroll', 'world chain', 'abstract', 'soneium', 'lisk',
]);

/** Rough gas for one transaction on a chain, in dollars. An estimate, stated as "about". */
function gasUsd(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 12;
  if (c === 'bitcoin' || c.includes('lightning')) return 2;
  if (CHEAP.has(c)) return 0.4;
  if (L2.has(c)) return 0.8;
  return 2;
}

function familyOf(category: string | null): Family {
  const c = (category ?? '').toLowerCase();
  if (c.includes('predict')) return 'predict';
  if (c.includes('insurance')) return 'insure';
  if (c.includes('derivative') || c.includes('option')) return 'deriv';
  if (c === 'dexs' || c.includes('dex')) return 'dex';
  if (c.includes('lending') || c.includes('cdp') || c.includes('collateral')) return 'credit';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('btc')) return 'btc';
  if (c.includes('restak') || c.includes('staking')) return 'stake';
  if (c === 'chain') return 'chain';
  if (c.includes('payment') || c.includes('card')) return 'pay';
  if (c.includes('stable')) return 'stable';
  if (c.includes('index')) return 'index';
  return 'vault';
}

function capitalFor(tvl: number, family: Family): number {
  let c = 40;
  if (tvl >= 1_000_000_000) c = 500;
  else if (tvl >= 250_000_000) c = 250;
  else if (tvl >= 50_000_000) c = 150;
  else if (tvl >= 15_000_000) c = 80;
  if (family === 'deriv' || family === 'predict') c = Math.max(40, Math.round(c / 2));
  return c;
}

function holdDays(age: number | null): number {
  if (age === null) return 28;
  if (age < 90) return 42;
  if (age < 200) return 35;
  if (age <= 700) return 28;
  return 21;
}

function money(n: number): string {
  const x = Math.round(n * 100) / 100;
  if (x < 1) return `$${x.toFixed(2)}`;
  if (Math.abs(x - Math.round(x)) < 0.001) return `$${Math.round(x)}`;
  return `$${x.toFixed(2)}`;
}

function book(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(n)}`;
}

function weekMove(change: number | null): string {
  if (change === null || !Number.isFinite(change)) return 'Its seven-day TVL change is unreported, so the probe stays at the size below.';
  const sign = change > 0 ? '+' : '';
  const pct = `${sign}${change.toFixed(1)}%`;
  if (change <= -15) return `TVL moved ${pct} over seven days, a real drawdown, so do not add size beyond this probe.`;
  if (change >= 20) return `TVL moved ${pct} over seven days. Keep the probe at this size anyway; a fast week is not a reason to scale up.`;
  return `TVL moved ${pct} over seven days.`;
}

function assetOf(family: Family, chain: string): string {
  const c = chain.toLowerCase();
  if (family === 'btc' || c === 'bitcoin' || c.includes('lightning')) return 'BTC';
  if (family === 'chain') return 'a stable asset';
  return 'stablecoins';
}

function pack(action: string, cost: string, time: string): string {
  return `${action} Cost: ${cost}. Time: ${time}.`.replace(/\s+/g, ' ').trim();
}

function entry(family: Family, name: string, category: string, chain: string, asset: string, capital: number): string {
  const filed = `${name} is filed as ${category}.`;
  switch (family) {
    case 'credit':
      return `Deposit ${money(capital)} of ${asset} into ${name} on ${chain} and keep the supply receipt in this wallet. ${filed} The action that counts is a supply.`;
    case 'dex':
      return `Add ${money(capital)} of liquidity to the deepest ${name} pool on ${chain}, using the two assets that pool lists, and keep the LP receipt. ${filed}`;
    case 'deriv':
      return `Post ${money(capital)} of ${asset} as margin on ${name} on ${chain}. ${filed} Do not open a position larger than that margin.`;
    case 'predict':
      return `Deposit ${money(capital)} on ${name} and buy one open-market position of about ${money(Math.max(10, Math.round(capital * 0.4)))}. ${filed}`;
    case 'rwa':
      return `Subscribe ${money(capital)} to the primary asset ${name} lists on ${chain} and hold the receipt in this wallet. ${filed}`;
    case 'insure':
      return `Buy cover with a ${money(capital)} notional from ${name} on ${chain}, for the shortest term the app lists. ${filed}`;
    case 'stake':
      return `Stake ${money(capital)} of the asset ${name} accepts on ${chain} and keep the staking receipt. ${filed}`;
    case 'pay':
      return `Send ${money(capital)} through ${name} on ${chain}, as a payment or as a channel funded with that amount. ${filed}`;
    case 'chain':
      return `Move ${money(capital)} of value onto ${chain} by the deposit route ${name}'s own app documents, and hold it in this wallet. ${filed}`;
    case 'stable':
      return `Mint or deposit ${money(capital)} of the stable asset through ${name} on ${chain} and keep the units in this wallet. ${filed}`;
    case 'index':
      return `Buy ${money(capital)} of the index position ${name} lists on ${chain} and keep it in this wallet. ${filed}`;
    case 'btc':
      return `Deposit ${money(capital)} of BTC into ${name} on ${chain} and hold the receipt the app returns. ${filed}`;
    default:
      return `Deposit ${money(capital)} of ${asset} into the largest vault ${name} lists on ${chain} and keep the receipt. ${filed} The action is a deposit into its own vault, not a loop on another protocol.`;
  }
}

function followUp(family: Family, name: string, chain: string, slice: number): { text: string; time: string } {
  switch (family) {
    case 'credit':
      return {
        text: `Within 48 hours, borrow about ${money(slice)} against that supply on ${name} and repay it the same day, so the wallet shows a supply, a borrow, and a repayment.`,
        time: '15 minutes, inside 48 hours',
      };
    case 'dex':
      return {
        text: `Within 48 hours, swap about ${money(slice)} through the same ${name} pool on ${chain} and swap it back, so the wallet is both a liquidity provider and a taker.`,
        time: '15 minutes, inside 48 hours',
      };
    case 'deriv':
      return {
        text: `Within 48 hours, open a hedge of about ${money(slice)} on ${name} and close it the same day. Budget about ${money(Math.max(1, Math.round(slice * 0.01)))} extra for the spread.`,
        time: '20 minutes, inside 48 hours',
      };
    case 'predict':
      return {
        text: `Within 48 hours, sell about half of that ${name} position back to the market so the account shows an entry and an exit.`,
        time: '15 minutes, inside 48 hours',
      };
    case 'rwa':
      return {
        text: `Within 48 hours, subscribe another ${money(slice)} to ${name} from the funds still in the wallet, a second lot rather than a single ticket.`,
        time: '15 minutes, inside 48 hours',
      };
    case 'insure':
      return {
        text: `Within 7 days, buy a second ${name} cover of about ${money(slice)} on a different risk, or extend the first cover if the app lists only one market.`,
        time: '20 minutes, inside 7 days',
      };
    case 'stake':
      return {
        text: `Within 48 hours, stake another ${money(slice)} with ${name} on ${chain}, or restake the receipt if the app offers that second step.`,
        time: '15 minutes, inside 48 hours',
      };
    case 'pay':
      return {
        text: `Within 48 hours, send a second payment of ${money(slice)} through ${name} so the history is two settlements, not one.`,
        time: '15 minutes, inside 48 hours',
      };
    case 'chain':
      return {
        text: `Within 48 hours, transfer about ${money(slice)} to a second address you control on ${chain} and send it back. Use ${name} as the chain you are active on.`,
        time: '15 minutes, inside 48 hours',
      };
    case 'stable':
      return {
        text: `Within 48 hours, redeem ${money(slice)} through ${name} and mint the same amount back the same day.`,
        time: '15 minutes, inside 48 hours',
      };
    case 'index':
      return {
        text: `Within 48 hours, sell ${money(slice)} of the ${name} index position and buy it back the same day.`,
        time: '15 minutes, inside 48 hours',
      };
    case 'btc':
      return {
        text: `Within 48 hours, add another ${money(slice)} of BTC to ${name}, or withdraw that amount and deposit it again if the app has a single vault.`,
        time: '15 minutes, inside 48 hours',
      };
    default:
      return {
        text: `Within 48 hours, move ${money(slice)} of the ${name} receipt into a second vault on ${chain}. If the app lists only one vault, withdraw ${money(slice)} and deposit it again.`,
        time: '15 minutes, inside 48 hours',
      };
  }
}

/**
 * Seven concrete steps. Capital is funded on day 0 and deployed in two lots.
 * Hold length follows how long the protocol has already been listed with no token recorded.
 */
export function farmSteps(p: FarmInput): string[] {
  const family = familyOf(p.category);
  const category = p.category ?? 'Uncategorized';
  const chain = p.chains[0] ?? 'its listed chain';
  const chain2 = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p.tvl_usd, family);
  const addon = Math.max(10, Math.round(capital * 0.4));
  const slice = Math.max(10, Math.round(capital * 0.3));
  const purse = capital + addon;
  const half = Math.round(purse / 2);
  const rest = purse - half;
  const gas = gasUsd(chain);
  const gas2 = gasUsd(chain2 ?? chain);
  const float = Math.max(gas * 3, 1);
  const hold = holdDays(p.age_days);
  const mid = Math.round(hold / 2);
  const visits = Math.max(3, Math.round(hold / 7));
  const spent = gas + gas + (chain2 ? gas2 : gas) + gas * visits + gas;
  const asset = assetOf(family, chain);
  const second = followUp(family, p.name, chain, slice);
  const ageClause =
    p.age_days === null
      ? 'No listing date is recorded, so the hold is 28 days.'
      : `It has been listed ${p.age_days} days with no token recorded, so the hold is ${hold} days.`;

  const day7 = chain2
    ? `On day 7, move the idle ${money(addon)} to ${chain2} through ${p.name}'s own app and deploy it there. ${p.name} lists ${chain} and ${chain2}.`
    : `On day 7, deploy the idle ${money(addon)} into the same ${p.name} position on ${chain}. Two deposits a week apart are a clearer record than one.`;

  const steps = [
    pack(
      `Fund a wallet used only for ${p.name}. Put ${money(purse)} on ${chain} (${money(capital)} for the first position and ${money(addon)} left idle until day 7) and keep ${money(float)} aside for gas. Store the seed offline. The book is ${book(p.tvl_usd)} across ${p.chains.length || 1} chain${p.chains.length === 1 ? '' : 's'} and the protocol records no token. ${weekMove(p.change_7d)}`,
      `${money(purse)} of capital and a ${money(float)} gas float`,
      '20 minutes',
    ),
    pack(entry(family, p.name, category, chain, asset, capital), `${money(capital)} deploys into the position, plus about ${money(gas)} gas`, '15 minutes'),
    pack(second.text, `about ${money(gas)} gas and no capital beyond the ${money(purse)} already funded`, second.time),
    pack(
      day7,
      `the idle ${money(addon)} already in the wallet, plus about ${money(chain2 ? gas2 : gas)} gas`,
      chain2 ? '20 minutes on day 7' : '10 minutes on day 7',
    ),
    pack(
      `Once a week for ${visits} weeks, do one small action on the ${p.name} position on ${chain}: a claim, a rebalance, or a ${money(Math.max(10, Math.round(capital * 0.05)))} adjustment. Skip a week if the app is paused. ${ageClause}`,
      `about ${money(gas)} gas a week and no scheduled new capital`,
      `10 minutes a week across ${hold} days`,
    ),
    pack(
      `On day ${mid}, open the rewards or points view inside the ${p.name} app you already used and write the balance next to this wallet address. Do not send funds to a new address that view shows.`,
      `$0 to read the page, or about ${money(gas)} if a claim transaction is required`,
      `15 minutes on day ${mid}`,
    ),
    pack(
      `On day ${hold}, withdraw ${money(half)} back to the funding wallet and leave ${money(rest)} in place until day ${hold + 14}. A later token recording is not promised; the point of the plan is the activity record. Gas spent across the plan is about ${money(spent)}, separate from the ${money(purse)} of capital.`,
      `about ${money(gas)} gas to withdraw half; capital at work until then is ${money(purse)}`,
      `day ${hold} to withdraw, day ${hold + 14} to finish`,
    ),
  ];

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (s.length < 20 || s.length > 600) {
      throw new Error(`farm step ${i + 1} for ${p.name} is ${s.length} characters`);
    }
  }
  return steps;
}
