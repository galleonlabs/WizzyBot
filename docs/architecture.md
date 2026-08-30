# Wizzy portfolio architecture

## Product boundary

Wizzy is self-custodial portfolio software. The wallet owns every LP NFT and signs every allocation, withdrawal, compound, or rebalance. Wizzy's server reads public chain state and returns short-lived, allowlisted transaction plans; it does not sign consumer transactions or maintain a shadow portfolio database.

## Authoritative state

| Concern | Authority |
| --- | --- |
| Curated chains, tokens, pools, weights, ranges, and product fees | `src/config/markets.json` in git |
| Wallet, balances, LP ownership, liquidity, fees, and range state | Base, Robinhood Chain, and Solana contracts/events |
| Short-lived price, liquidity, and volume context | Pool contracts and indexed market APIs, labeled with source/time window |
| Cross-chain intent and fill status | Relay quote plus Relay intent status, tied to its request ID |
| AI explanations and suggestions | Advisory only; never transaction authority |

The six-hour curator produces evidence and policy-valid replacement proposals. The curator agent reviews those outputs, updates `src/config/markets.json`, and ships the normal tested application deployment. There is no onchain publication or registry gas cost in the current launch architecture.

## Index deposit path

The public product has one fixed index. It does not expose the single-chain allocation APIs, pools, venues, weights, or ranges as consumer controls.

1. The user enters one ETH amount on Base. The server validates the versioned market policy and returns short-lived plans for every active market.
2. The first Privy approval opens the Base positions, pays the disclosed deposit fee, and funds Relay deposits for Robinhood Chain and native SOL.
3. Wizzy waits for Relay before asking for the Robinhood and Solana approvals. Privy keeps the EVM and Solana wallets under the same login, but each network still requires its own wallet authorization.
4. EVM positions are minted to the user's wallet. Meteora DLMM positions are created with the user's Solana wallet as owner.
5. Portfolio reads query the reviewed EVM position managers and configured Meteora pools directly. No shadow portfolio database is required.

## Internal EVM planning paths

### One chain

1. The server validates the selected allowlisted markets and quotes every WETH-to-meme swap onchain.
2. It prepares one EIP-5792 `wallet_sendCalls` batch: wrap ETH, exact approvals, swaps with minimum outputs, mints with the user's wallet as NFT recipient, and a disclosed Wizzy fee transfer.
3. The client shows the complete plan and requests one wallet confirmation. An expired plan must be rebuilt.

### Base and Robinhood Chain

Permissionless launch path: two confirmations from one Base funding balance.

1. Base confirmation atomically executes the Base allocation and a Relay native-ETH deposit for Robinhood Chain.
2. Wizzy monitors the Relay request ID. After success, it switches the wallet to Robinhood Chain and requests the second atomic allocation batch.
3. The Robinhood allocation is sized from Relay's minimum output less a gas reserve; any better fill remains in the user's wallet.

A one-confirmation cross-chain call path is a later capability gate. Relay can execute destination calls with smart accounts, but preserving the user's `msg.sender`, sponsorship, and safe handling of dynamic swap leftovers must be proven with the actual Privy/Relay production configuration before Wizzy advertises it.

### Solana

Relay delivers native SOL to the user's Privy Solana wallet. Wizzy uses the pinned Meteora zap SDK to create positions only in pools from `src/config/solana-markets.json`. Position reads query those pools by owner. Withdraw and reinvest plans verify the owner, pool, position, fee, expiry, signer set, and instruction program allowlist before Privy requests signatures.

Solana token fees land in associated token accounts controlled by `UNABOT_SOLANA_TREASURY`. Native SOL fees accrue as recoverable surplus lamports on the same per-market token account, avoiding an undisclosed rent top-up for an otherwise empty treasury system account.

## Analytics contract

Revert's position tooling makes the useful comparison set concrete: pool and fee tier, NFT ID, owner, asset amounts, PnL, fee APR, total return, age, range state, time in range, and performance versus holding. Wizzy should show those at position level and aggregate value, fees, chain allocation, range health, and risk at portfolio level.

Annualized numbers are unstable for young or briefly active positions. Wizzy labels trailing windows, withholds APR for insufficient history, and presents scenarios rather than guaranteed projections. Market curation is deterministic and reviewable; AI may explain inclusions, exclusions, risks, and proposed range changes but cannot silently alter the allowlist or sign.

## Compounding

Compound only when simulated fees after Wizzy's disclosed fee exceed estimated gas and the configured economic threshold. Revert Compoundor's keeper is a useful model: compare estimated gains against execution cost, prefer the least costly viable token conversion, group compatible work, and back off after failures. Wizzy's self-custodial launch flow prepares the compound batch for user approval; delegated automation requires a separate, narrowly scoped session-key policy and is not implied by login.
