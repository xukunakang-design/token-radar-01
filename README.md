# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/xukunakang-design/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/xukunakang-design/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token-launch radar: 226 pre-token protocols, ranked by implied value, each
with an eight-step farm plan.

## What it is

- **Board of 226 pre-token protocols**: all 40 watchlist protocols, plus 186
  early protocols below the $50M TVL floor. Live-token protocols are set aside
  with their market caps shown.
- **Implied value** (model radar-2) for every row: TVL times a size multiple
  times a growth multiple times a maturity multiple. No protocol is
  special-cased; the dashboard recomputes every row from the same formula.
- **Farm plan**: eight steps per protocol, every step with a cost and a time,
  built from the protocol's category, chains, TVL and age.
- **Dashboard**: dark theme, sortable and filterable table, a detail view per
  protocol with the model breakdown, and a top-5 strip.

## Model (radar-2)

```
implied = TVL x size x growth x maturity
size     = 0.25 x (TVL / $1B) ^ -0.15
growth   = 1 + clamp(change_7d, -50, 100) / 100 x 1.5
maturity = 0.5 + 0.5 x min(age_days, 1095) / 1095
```

Age is the time since the protocol was first listed; an unlisted age uses 365
days. The size multiple compresses as TVL grows, so a token is worth fewer
dollars per dollar of TVL at $2B than at $200M. Implied value is a model, not
a promise.

## Data

Snapshot: 758 protocols from the DefiLlama protocol index, as of 2026-11-14.
Watchlist: 40 protocols. Floor: $50,000,000 TVL.

## Run it

```
node main.ts --input <snapshot.json>
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` to the output directory (default `./out`, or
`$MAKEFUN_OUTPUT_DIR`). Runs twice byte-identical.

## Entry

Built for the make.fun `token-radar-01` bounty.

---

Entered on [make.fun](https://make.fun/?ref=7vmake0j&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
