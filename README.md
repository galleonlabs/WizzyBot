# Wizzy

Make Meme Markets.

Make markets on Base and Robinhood Chain. Your EOA owns every position.

- Pools first: every ETH-paired meme pool on Uniswap V2/V3/V4 and Aerodrome Slipstream across Base and Robinhood Chain, swept from GeckoTerminal every ten minutes and curated deterministically: scams and dust out, honeypots and high-tax tokens out via GoPlus on Base, thin and brand-new pools kept but flagged. The hand-reviewed catalog always makes the menu.
- Wizzy is a monetised Relay wrapper. "LP this pool" swaps the wallet into the exact tokens the pool needs from any of five networks, with a 0.3% Wizzy fee inside the Relay quote paid to the treasury, then opens the pool's create page on Uniswap or Aerodrome to set the range.
- Positions: every LP in the wallet with value, unclaimed fees, pool fee APR, and a live range chart. Collect, reduce, and exit run in-app only when they are one transaction; everything multi-step links to the venue. After an exit, selling the meme token for ETH is one more monetised Relay step.
- Connect an external wallet. Wizzy never creates or controls one and never holds funds.
- The curator reviews both chains every six hours and ships policy-valid catalog changes through the tested Git path.
- The application launches without a Wizzy token. Any future token is a separate, gated release.

[Production runbook](docs/RUNBOOK.md) · [Future token plan](docs/TOKEN_FLYWHEEL.md) · [Launch privacy](docs/LAUNCH_PRIVACY.md)
