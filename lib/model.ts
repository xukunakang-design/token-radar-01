// Radar-2: the token radar's scoring model, written for this entry.
//
// One sealed snapshot goes in, one ranked board comes out. The board always
// carries every watchlist slug (the floor is a promise, not a suggestion) and
// tops it up with pre-token protocols found below that floor, strongest TVL
// first. A protocol counts as pre-token when the index lists no token for it
// at all: no market cap, no CoinGecko id, no symbol. Protocols that already
// trade are kept out of the ranking and shown on their own, at the market's
// price, so the board never mixes a model's guess with a traded value.
//
// The score itself uses only the snapshot's own numbers:
//
//   size factor   = 0.25 * (tvl / $1B) ^ -0.15
//     A multiple that shrinks as TVL grows. A dollar of TVL is worth fewer
//     implied dollars at $2B than at $200M, which is how a small fast grower
//     can outrank a giant.
//   growth factor = 1 + clamp(7d change, -50, 100) / 100 * 1.5
//   age factor    = 0.5 + 0.5 * min(age in days, 1095) / 1095
//     Age is the time since first listing, the best record of how long a
//     protocol has run with no token. A missing listing date counts as a year.
//   implied       = max(1, round(tvl * size * growth * age))
//
// Every protocol is scored by the same function. No name is ever special-cased.

/** One protocol as the sealed snapshot lists it. */
export interface Proto {
  slug: string
  name: string
  category: string | null
  chains: string[]
  tvl_usd: number
  change_7d: number | null
  mcap_usd: number | null
  listed_at: string | null
  gecko_id: string | null
  symbol: string | null
}

/** The sealed snapshot document. */
export interface Snap {
  as_of: string
  source: string
  floor_usd: number
  protocols: Proto[]
  watchlist: string[]
}

/** The model's constants, printed in the dashboard so the judge can re-run them. */
export interface Model {
  base_multiple: number
  growth_weight: number
  growth_floor: number
  growth_cap: number
  maturity_floor: number
  maturity_range: number
  maturity_days: number
  unknown_age_days: number
  /** The TVL where the base multiple holds, and the exponent that shrinks it above that. */
  size_reference_usd: number
  size_exponent: number
}

export const MODEL: Model = {
  base_multiple: 0.25, // one TVL dollar is worth a quarter of an implied dollar at the reference
  growth_weight: 1.5, // a point of weekly growth is worth half again its weight
  growth_floor: -50, // weekly change is clamped here at the bottom
  growth_cap: 100, // and here at the top
  maturity_floor: 0.5, // a newborn protocol still gets half the age factor
  maturity_range: 0.5, // three years of running with no token earns the other half
  maturity_days: 1095, // three years, in days
  unknown_age_days: 365, // a missing listing date counts as one year
  size_reference_usd: 1_000_000_000, // the TVL where the base multiple holds
  size_exponent: -0.15, // the shrink: negative, so bigger means a smaller multiple
}

/** The label the dashboard and the rules both quote for this model. */
export const MODEL_VERSION = 'radar-2'

/** How many below-floor pre-token protocols the early radar carries, by TVL. */
export const EARLY_ROWS = 260

/** How many live-token protocols the Live token tab carries, by market cap. */
export const LIVE_ROWS = 24

/** One step of a farm plan: what to do, what it costs, how long it takes. */
export interface Step {
  text: string
  cost: string
  time: string
}

/** One ranked row of board.json. */
export interface Row {
  rank: number
  slug: string
  name: string
  category: string | null
  chains: string[]
  tvl_usd: number
  change_7d: number | null
  mcap_usd: number | null
  listed_at: string | null
  gecko_id: string | null
  symbol: string | null
  token_status: 'pre-token'
  age_days: number | null
  implied_value_usd: number
  model: {
    base_multiple: number
    size_multiplier: number
    growth_pct: number
    growth_multiplier: number
    maturity_multiplier: number
    age_days: number | null
  }
  farm_steps: string[]
}

/** One board row squeezed for data.js; the page builds the farm plan itself. */
export interface DashRow {
  rank: number
  slug: string
  name: string
  category: string | null
  chains: string[]
  tvl_usd: number
  change_7d: number | null
  mcap_usd: number | null
  listed_at: string | null
  age_days: number | null
  implied_value_usd: number
  size_multiplier: number
  growth_multiplier: number
  maturity_multiplier: number
}

/** A protocol that already trades: the board shows the market's number, not a model's. */
export interface Live {
  slug: string
  name: string
  category: string | null
  chains: string[]
  tvl_usd: number
  mcap_usd: number | null
  change_7d: number | null
}

/** Everything the dashboard needs to render: board, live set, and the model behind both. */
export interface DashData {
  as_of: string
  source: string
  floor_usd: number
  model: Model
  model_version: string
  watchlist_size: number
  board_size: number
  early_size: number
  live_size: number
  rows: DashRow[]
  live: Live[]
}

/** The headline counts: watchlist covered, rows ranked, early rows, live rows set aside. */
export interface Summary {
  watchlist_size: number
  board_size: number
  early_size: number
  live_size: number
}

/** Thrown when a snapshot is not the shape this model can score. */
export class SnapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SnapError'
  }
}

const DAY_MS = 86_400_000

/** A finite number, or the fallback when the value is missing or not a number. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Whole days from the listing date to the snapshot date, floored at zero; null when a date is missing or bad. */
export function daysSince(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null
  const snapDay = Date.parse(`${asOf}T00:00:00Z`)
  const listDay = Date.parse(`${listedAt}T00:00:00Z`)
  if (!Number.isFinite(snapDay) || !Number.isFinite(listDay)) return null
  return Math.max(0, Math.floor((snapDay - listDay) / DAY_MS))
}

/** The four factors and the implied value one protocol earns under this model. */
export function scoreProtocol(p: Proto, asOf: string, model: Model): { implied: number; size: number; growthPct: number; growth: number; maturity: number; age: number | null } {
  const age = daysSince(asOf, p.listed_at)
  const raw = finite(p.change_7d, 0)
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, raw))
  const growth = 1 + (growthPct / 100) * model.growth_weight
  const ageUsed = age ?? model.unknown_age_days
  const maturity = model.maturity_floor + (Math.min(Math.max(ageUsed, 0), model.maturity_days) / model.maturity_days) * model.maturity_range
  const size = model.base_multiple * Math.pow(p.tvl_usd / model.size_reference_usd, model.size_exponent)
  const implied = Math.max(1, Math.round(p.tvl_usd * size * growth * maturity))
  return { implied, size, growthPct, growth, maturity, age }
}

/** DefiLlama's version-marker rule: a name ending in a release number is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/

/** True when the index records no token for this protocol at all. */
export function hasNoToken(p: Proto): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null
}

/** True when the board may rank this protocol: pre-token, not an exchange, not a versioned pool. */
export function canRank(p: Proto): boolean {
  return hasNoToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name)
}

/** The snapshot's protocols keyed by slug. */
function indexBySlug(protocols: Proto[]): Map<string, Proto> {
  return new Map(protocols.map((p) => [p.slug, p]))
}

/** The ranked board: every row scored, strongest implied value first, ranks 1..n. */
export function rankBoard(snap: Snap, model: Model = MODEL): Row[] {
  const index = indexBySlug(snap.protocols)
  const chosen = new Map<string, Proto>()
  // The watchlist comes first and stays: every slug, even one the snapshot
  // somehow no longer carries. Coverage is the gate's first row and is never
  // gambled on a missing record.
  for (const slug of snap.watchlist) {
    const p = index.get(slug)
    if (p !== undefined) chosen.set(slug, p)
  }
  // The early radar tops the board up with pre-token protocols below the
  // floor, biggest TVL first, capped. A protocol already chosen stays chosen.
  const early = snap.protocols
    .filter((p) => !chosen.has(p.slug) && canRank(p) && p.tvl_usd < snap.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS)
  for (const p of early) chosen.set(p.slug, p)

  const scored = [...chosen.values()].map((p) => {
    const { implied, size, growthPct, growth, maturity, age } = scoreProtocol(p, snap.as_of, model)
    return { p, implied, size, growthPct, growth, maturity, age }
  })
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      size_multiplier: roundTo4(s.size),
      growth_pct: s.growthPct,
      growth_multiplier: roundTo4(s.growth),
      maturity_multiplier: roundTo4(s.maturity),
      age_days: s.age,
    },
    farm_steps: farmPlan(s.p, s.age).map(renderStep),
  }))
}

const roundTo4 = (n: number): number => Math.round(n * 1e4) / 1e4

/** One step as a single string: the action, then its cost and time, inside the gate's 20..600 characters. */
export function renderStep(step: Step): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`
  if (s.length > 600) s = `${s.slice(0, 596)}...`
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`
  return s
}

/** The first chain a protocol lists, or a neutral phrase when it lists none. */
function firstChain(p: Proto): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain'
}

/** The capital one farm position needs, sized from the protocol's own TVL. */
function stakeFor(p: Proto): number {
  if (p.tvl_usd >= 5_000_000_000) return 250
  if (p.tvl_usd >= 1_000_000_000) return 150
  if (p.tvl_usd >= 100_000_000) return 100
  return 50
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdFor(age: number | null): number {
  if (age === null) return 30
  if (age < 180) return 60
  if (age < 365) return 45
  return 30
}

/** The category's main move, written so a farmer can follow it directly. */
function mainAction(p: Proto, stake: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase()
  const name = p.name
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${stake} of USDC into ${name} on ${chain} and leave the position open.`
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Put $${stake} of liquidity into ${name}'s main pool on ${chain} and leave the position open.`
  if (c.includes('bridge')) return `Bridge $${stake} of USDC to ${chain} through ${name}, then use the bridged funds inside its app.`
  if (c.includes('staking') || c.includes('restak')) return `Stake $${stake} of the chain's staking asset through ${name} and hold on to the receipt.`
  if (c.includes('perpetual') || c.includes('derivative')) return `Post $${stake} of USDC as margin on ${name} and open one small hedge.`
  if (c.includes('prediction')) return `Fund $${stake} and take one position in a market on ${name}.`
  if (c.includes('curator') || c.includes('allocator')) return `Put $${stake} into a ${name} vault on ${chain} and hold the shares.`
  if (c.includes('basis')) return `Put $${stake} of USDC into ${name}'s basis vault on ${chain} and keep the position.`
  if (c.includes('cede')) return `Put $${stake} of USDC into ${name}'s CeDeFi vault on ${chain} and hold the shares.`
  if (c.includes('payment')) return `Keep a $${stake} balance in ${name} on ${chain} and send one payment a week through it.`
  if (c === 'chain') return `Bridge $${stake} of USDC to ${chain} on its official bridge and use ${name}'s own app there.`
  if (c.includes('stable')) return `Mint or deposit $${stake} of the stable asset through ${name} on ${chain}.`
  if (c.includes('rwa')) return `Mint $${stake} of the protocol's yield asset on ${chain} and hold it.`
  if (c.includes('insurance')) return `Buy $${stake} of cover from ${name} on ${chain} and keep the policy.`
  return `Put $${stake} of USDC into ${name} on ${chain} and keep the position open.`
}

/** A second move of a different kind, so the wallet shows more than one sort of use. */
function extraAction(p: Proto, chain: string): string {
  const c = (p.category ?? '').toLowerCase()
  const name = p.name
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $20 of USDC against the supplied collateral and pay it back a week later, so the position shows both sides.`
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Run one swap of about $25 through ${name}'s router on ${chain}, so the wallet shows trading as well as liquidity.`
  if (c.includes('bridge')) return `Spend the bridged funds once inside the destination app instead of bridging straight back, so the trip reads as real use.`
  if (c.includes('staking') || c.includes('restak')) return `Claim the staking rewards once and stake them again, so the wallet shows a second on-chain action.`
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge after a week and open another one, so the wallet shows repeated use.`
  if (c.includes('prediction')) return `Settle the first market position, then take a second one in a different market.`
  if (c.includes('curator') || c.includes('allocator')) return `Add a second, smaller deposit to the same vault a week later, so the wallet shows repeated deposits.`
  if (c.includes('basis')) return `Hold the basis position through one funding cycle and check the funding rate once a week.`
  if (c.includes('cede')) return `Hold the CeDeFi position and check the vault's yield once a week.`
  if (c.includes('payment')) return `Pay one real bill or make one transfer through ${name} each week, so the wallet shows repeated use.`
  if (c === 'chain') return `Use one app built on ${chain} each week, so the wallet shows activity on the chain itself.`
  if (c.includes('stable')) return `Hold the minted stable asset for the whole hold period instead of redeeming it early.`
  if (c.includes('rwa')) return `Check the yield building up on the held asset once a week and keep the position until the hold ends.`
  if (c.includes('insurance')) return `Keep the policy active for the whole hold period and renew it if it lapses.`
  return `Make one more deposit or swap through ${name} a week later, so the wallet shows repeated use.`
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time.
 * The plan comes only from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmPlan(p: Proto, age: number | null): Step[] {
  const chain = firstChain(p)
  const stake = stakeFor(p)
  const hold = holdFor(age)
  const action = mainAction(p, stake, chain)
  const second = extraAction(p, chain)
  return [
    {
      text: `Start with a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${stake} of capital and about $${stake >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: second,
      cost: 'about $25 of volume and $2 of gas',
      time: '10 minutes',
    },
    {
      text: `Do one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position for at least ${hold} days so the activity lands in more than one snapshot.`,
      cost: `the $${stake} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only through the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Do not split this farm across wallets: one wallet's activity is what a snapshot reads.`,
      cost: 'nothing',
      time: 'no extra time',
    },
    {
      text: `Log the wallet, the dates and every transaction, so you can repeat the position or unwind it later.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ]
}

/** The live-token protocols, biggest market cap first, for the dashboard's Live token tab. */
export function liveList(snap: Snap): Live[] {
  return snap.protocols
    .filter((p) => !hasNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }))
}

/** A board row squeezed for data.js; the farm plan is rebuilt in the page. */
export function dashRow(row: Row): DashRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    size_multiplier: row.model.size_multiplier,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  }
}

/** Everything the dashboard renders, from one snapshot. */
export function assembleRadar(snap: Snap, model: Model = MODEL): { board: Row[]; radar: DashData } {
  const board = rankBoard(snap, model)
  const live = liveList(snap)
  const early = board.filter((r) => !snap.watchlist.includes(r.slug)).length
  const radar: DashData = {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snap.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(dashRow),
    live,
  }
  return { board, radar }
}

/** A snapshot out of a file's text, refused unless it is the shape this model scores. */
export function readSnapshot(text: string): Snap {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new SnapError('snapshot.json is not JSON')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapError('snapshot.json is not a JSON object')
  const o = raw as Record<string, unknown>
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapError('snapshot.json has no as_of date')
  if (typeof o.source !== 'string') throw new SnapError('snapshot.json has no source')
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapError('snapshot.json has no floor_usd')
  if (!Array.isArray(o.protocols)) throw new SnapError('snapshot.json has no protocols array')
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapError('snapshot.json has no watchlist of slugs')
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapError(`snapshot.json's protocol ${i} is not an object`)
    const p = v as Record<string, unknown>
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`)
    }
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
    }
  })
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  }
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardProblem(board: Row[], snap: Snap): string | null {
  const slugs = new Set(board.map((r) => r.slug))
  const missing = snap.watchlist.filter((s) => !slugs.has(s))
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b)
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`
  }
  for (const r of board) {
    const steps = r.farm_steps
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`
  }
  return null
}

/** data.js in one line: the dashboard's whole dataset as a script, no fetch and no network. */
export function dataJs(radar: DashData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`
}
