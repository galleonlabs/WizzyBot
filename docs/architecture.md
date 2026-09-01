# Wizzy portfolio architecture

## Product boundary

Wizzy is self-custodial portfolio software. The wallet owns every LP NFT and signs every allocation, withdrawal, compound, or rebalance. Wizzy's server reads public chain state and returns short-lived, allowlisted transaction plans; it does not sign consumer transactions or maintain a shadow portfolio database.

## Authoritative state

| Concern | Authority |
| --- | --- |
| Reviewed chains, tokens, pools, ranges, and product fees | `src/config/markets.json` in git |
| Wallet, balances, LP ownership, liquidity, fees, and range state | Base, Robinhood Chain, and Solana contracts/events |
| Short-lived price, liquidity, and volume context | Pool contracts and indexed market APIs, labeled with source/time window |
| Cross-chain intent and fill status | Relay quote plus Relay intent status, tied to its request ID |
| AI explanations and suggestions | Advisory only; never transaction authority |

The six-hour dappnode curator combines deterministic evidence with read-only deep web research. The rules engine alone authorizes replacements; the research agent can verify identity or veto a proposal, but cannot invent an executable change. A validated update changes the centralized JSON catalog in a disposable worktree, passes the full release gate, and ships through Git/Vercel. There is no onchain publication or registry gas cost in the current launch architecture.

## Market entry path

The public product presents reviewed markets on Base and Robinhood Chain. Protocol and range mechanics stay behind each market's review state.

1. The user chooses a reviewed market and enters one ETH amount.
2. The server validates the versioned market policy and returns a short-lived plan for that chain.
3. The connected EOA reviews the swap, liquidity, fee, and gas reserve before approval.
4. The LP position is minted directly to that EOA.
5. Portfolio reads query reviewed position managers and pools directly. No shadow portfolio database is required.

## Internal EVM planning paths

### One chain

1. The server validates one selected allowlisted market and quotes its WETH-to-meme swap onchain.
2. It prepares the exact wrap, approval, swap, mint, and disclosed Wizzy fee transactions for that market, with the user's wallet as NFT recipient.
3. The client shows the complete plan and requests each wallet confirmation in order, waiting for a successful receipt before continuing. An expired plan must be rebuilt.

### Base and Robinhood Chain

Permissionless launch path: one selected market on one funded chain.

1. The user chooses one market on Base or Robinhood Chain.
2. Wizzy prepares the allowlisted swap, range, LP mint, and service-fee steps for that market.
3. The connected wallet reviews and approves the allowlisted transactions sequentially. Completed steps remain self-custodial if a later transaction fails.

Cross-chain funding remains a separate action. Wizzy does not advertise a basket, automatic chain split, or one-confirmation cross-chain execution path.

### Solana

The dormant Solana path uses the pinned Meteora zap SDK and only pools from `src/config/solana-markets.json`. It is not part of the current Base and Robinhood product. Any future reactivation must use a user-controlled Solana signer and re-prove the owner, pool, position, fee, expiry, signer set, and program allowlist.

Solana token fees land in associated token accounts controlled by `UNABOT_SOLANA_TREASURY`. Native SOL fees accrue as recoverable surplus lamports on the same per-market token account, avoiding an undisclosed rent top-up for an otherwise empty treasury system account.

## Analytics contract

Revert's position tooling makes the useful comparison set concrete: pool and fee tier, NFT ID, owner, asset amounts, PnL, fee APR, total return, age, range state, time in range, and performance versus holding. Wizzy should show those at position level and keep the wallet summary limited to value, claimable fees, and range health.

Annualized numbers are unstable for young or briefly active positions. Wizzy labels trailing windows, withholds APR for insufficient history, and presents scenarios rather than guaranteed projections. Market curation is reviewable and fail-closed: AI research may update candidate identity and approve only a deterministic policy proposal; it cannot bypass thresholds, create arbitrary calldata, access signing keys, or transact.

## Compounding

Compound only when simulated fees after Wizzy's disclosed fee exceed estimated gas and the configured economic threshold. Revert Compoundor's keeper is a useful model: compare estimated gains against execution cost, prefer the least costly viable token conversion, group compatible work, and back off after failures. Wizzy's self-custodial launch flow prepares the compound transaction plan for user approval; delegated automation requires a separate, narrowly scoped session-key policy and is not implied by login.
