# Contract-level innovation for Wizzy (exercise, 2026-09-01)

What could Wizzy build at the contract layer that a UI-over-Morpho cannot claim? Constraint: fork only bases with clean security records, and innovate where our actual differentiator lives — the agent curator loop.

## Security records, honestly

Worth naming plainly because the reference point in the prompt cuts the other way: **Harvest Finance lost ~$24M in October 2020** to a flash-loan curve-price manipulation of its fUSDT/fUSDC vaults. Other famous stumbles: Yearn v1 DAI vault (~$11M, 2021), Compound's COMP distribution bug (~$80M+, 2021), Euler (~$197M, 2023, later recovered), Curve's Vyper reentrancy (2023), Balancer (repeatedly). The clean-core shortlist relevant to us:

| Base | Record | Why it matters to us |
| --- | --- | --- |
| **Morpho Blue + MetaMorpho** | Clean; minimal immutable core, formally verified | Already our substrate; MetaMorpho is the closest fork base (roles, caps, timelocks exist) |
| **Yearn V3 TokenizedStrategy** | Clean V3 record; explicitly designed as a fork/build framework | Modular 4626 strategy pattern, battle-tested periphery |
| **Uniswap core** | The cleanest record in DeFi | Ethos proof: tiny immutable cores survive |
| **Maker/Sky savings (sUSDS/DSR)** | Clean core since 2019 | The yield-wrapper pattern users trust |
| **Pendle core** | Strong record | The fixed-rate/yield-splitting frontier if we ever go there |
| **ERC-4626 / ERC-7540** | Standards, not protocols | Composability for free |

License check is a real step before any fork (MetaMorpho is GPL-family, Yearn V3 AGPL, Blue's core has BUSL history — verify current terms per repo).

## The innovation thesis: put the agent's leash onchain

Every agent-managed vault today asks users to trust the operator's offchain judgment. Our curator loop already runs deterministic policy gates — TVL floors, collapse triggers, timelock minimums — but they live in TypeScript on dappnode. The contract-level innovation is to make the **policy the contract and the agent merely a proposer within it**:

### 1. The policy-enforced agent vault (flagship)

A minimal 4626 meta-vault (fork base: MetaMorpho's role architecture, stripped) where:

- **The venue universe is immutable or timelocked-tight**: the allowlist of underlying blue-chip 4626 vaults is set at deploy (or additions sit behind a long timelock + guardian veto). The agent can never introduce a venue.
- **Policy invariants are enforced in Solidity, not prose**: per-venue allocation caps, max reallocation drift per 24h, minimum venue count (forced diversification), and an oracle-checked **depeg/TVL circuit breaker** that blocks new allocation into a venue breaching thresholds.
- **The agent is only the allocator**: a bounded key (dappnode) that proposes weight shifts inside those invariants. Every gate it passes is verifiable by anyone reading the chain.
- **Dead-man's switch**: if the allocator stops heartbeating for N days, the vault auto-derisks to its designated safest venue and opens permissionless `derisk()`. An abandoned agent cannot strand funds in a decaying venue.

Pitch in one line: *the first vault where you can verify what the AI is allowed to do.* Nobody in the agent-vault wave (and there is a wave) has made the leash itself the product. It is also small enough to be genuinely auditable — the Uniswap/Blue lesson is that tiny immutable cores are the ones with clean records.

### 2. Deposit-seconds: an onchain loyalty primitive (small, sharp)

A non-custodial periphery contract that accrues **deposit-seconds** (balance × time) per address from the vault's own share accounting. It replaces trust-me points programs with a verifiable primitive: the XP/quest system reads it, a future token allocates against it, and third parties can compose with it ("proof of patience"). Zero custody risk — it only reads share balances and checkpoints. This is the contract half of the token flywheel already sketched in [morpho-curator-and-token.md](morpho-curator-and-token.md).

### 3. Rate-smoothed share price (nice-to-have, later)

A smoothing buffer that drips realized yield into the share price over a window (sDAI-style), making the APY line users see boring in the best way. Small mechanism, real UX differentiation for a "stable" product. Adds accounting complexity — only after 1 and 2.

### Ranked verdict

Build order if this graduates from exercise to plan: **1** (the moat — policy-enforced agent vault, ~2–4 weeks of contract work + audit), **2** (a weekend of Solidity, immediately useful to quests/token), **3** (later). Not worth doing: forking a strategy-zoo aggregator (the Harvest/Yearn-v1 lesson — every strategy is attack surface), fixed-rate tranching (Pendle already owns it), or any custody-touching novelty. The differentiator isn't a new yield source; it's **verifiable agent governance over boring, proven yield sources** — which is exactly the product's story told in Solidity.
