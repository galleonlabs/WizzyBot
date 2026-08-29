# Una portfolio architecture

## Product boundary

Una is self-custodial portfolio software. The wallet owns every LP NFT and signs every allocation, withdrawal, compound, or rebalance. Una's server reads public chain state and returns short-lived, allowlisted transaction plans; it does not sign consumer transactions or maintain a shadow portfolio database.

## Authoritative state

| Concern | Authority |
| --- | --- |
| Curated chains, tokens, pools, weights, ranges, and product fees | `src/config/markets.json` in git |
| Wallet, balances, LP ownership, liquidity, fees, and range state | Base and Robinhood Chain contracts/events |
| Short-lived price, liquidity, and volume context | Pool contracts and indexed market APIs, labeled with source/time window |
| Cross-chain intent and fill status | Relay quote plus Relay intent status, tied to its request ID |
| AI explanations and suggestions | Advisory only; never transaction authority |

## Allocation paths

### One chain

1. The server validates the selected allowlisted markets and quotes every WETH-to-meme swap onchain.
2. It prepares one EIP-5792 `wallet_sendCalls` batch: wrap ETH, exact approvals, swaps with minimum outputs, mints with the user's wallet as NFT recipient, and a disclosed Una fee transfer.
3. The client shows the complete plan and requests one wallet confirmation. An expired plan must be rebuilt.

### Base and Robinhood Chain

Permissionless launch path: two confirmations from one Base funding balance.

1. Base confirmation atomically executes the Base allocation and a Relay native-ETH deposit for Robinhood Chain.
2. Una monitors the Relay request ID. After success, it switches the wallet to Robinhood Chain and requests the second atomic allocation batch.
3. The Robinhood allocation is sized from Relay's minimum output less a gas reserve; any better fill remains in the user's wallet.

A one-confirmation cross-chain call path is a later capability gate. Relay can execute destination calls with smart accounts, but preserving the user's `msg.sender`, sponsorship, and safe handling of dynamic swap leftovers must be proven with the actual Privy/Relay production configuration before Una advertises it.

## Analytics contract

Revert's position tooling makes the useful comparison set concrete: pool and fee tier, NFT ID, owner, asset amounts, PnL, fee APR, total return, age, range state, time in range, and performance versus holding. Una should show those at position level and aggregate value, fees, chain allocation, range health, and risk at portfolio level.

Annualized numbers are unstable for young or briefly active positions. Una labels trailing windows, withholds APR for insufficient history, and presents scenarios rather than guaranteed projections. Market curation is deterministic and reviewable; AI may explain inclusions, exclusions, risks, and proposed range changes but cannot silently alter the allowlist or sign.

## Compounding

Compound only when simulated fees after Una's disclosed fee exceed estimated gas and the configured economic threshold. Revert Compoundor's keeper is a useful model: compare estimated gains against execution cost, prefer the least costly viable token conversion, group compatible work, and back off after failures. Una's self-custodial launch flow prepares the compound batch for user approval; delegated automation requires a separate, narrowly scoped session-key policy and is not implied by login.
