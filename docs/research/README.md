# UnaBot research corpus

Durable SME notes for UnaBot. Written 29 Aug 2026 (Europe/London). Product knowledge — not a Uniswap Labs, Bankr, Revert, or Virtuals publication.

**Rule:** every address and fee in this folder is copied from a cited official page or `deployments.json`. If a number is inferred, it is marked **speculation**. Do not invent contract addresses.

## Files

| File | Job |
| --- | --- |
| [uniswap.md](uniswap.md) | Uniswap LP API + Trading API, Base v2/v3/v4 addresses, MCP/skills/CLI, LP primitives |
| [bankr.md](bankr.md) | Product surfaces, Club pricing, Doppler 1.75% table, `$BNKR` CA, skills org, May 2026 prompt-injection incidents, copy vs skip |
| [fomo-relay.md](fomo-relay.md) | Fomo’s single-balance UX, Privy custody boundary, Relay’s permissionless two-stage path, and the enterprise one-click gate |
| [revert.md](revert.md) | Compound / range / exit, user-held position, Base automator addresses, fees, v3 vs v1 Compoundor, Jan 2026 Aerodrome Lend incident |
| [virtuals.md](virtuals.md) | Alternative-provider research only: 1% tax 70/30, 42k VIRTUAL graduation, 10y lock, ACP, Tax Manager |
| [product.md](product.md) | UnaBot positioning, fee schedule, surfaces, threat model |

## Canonical product facts

- UnaBot. Uniswap LP on autopilot.
- v2, v3, and v4. You keep the position.
- Compound, re-range, exit.
- Chain: Base `8453`
- Treasury: `0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42`
- No vault custody. No Revert Lend. No Aerodrome.
- Dry-run is the default. `--live` is the only broadcast path.

## How to refresh

1. Re-read `https://developers.uniswap.org/deployments.json` (generated 2026-07-15 at last pull; always re-fetch).
2. Re-read protocol pages under `https://developers.uniswap.org/docs/protocols/{v2,v3,v4}/deployments`.
3. Re-read `https://docs.bankr.bot/llms-full.txt`, `https://docs.revert.finance/revert/resources/contract-addresses`, `https://whitepaper.virtuals.io/about-virtuals/capital-formation-layer`.
4. If an official page and this corpus disagree, the official page wins. Update the file and the Last verified line.

## Last verified

29 Aug 2026 against live docs listed in each file.
