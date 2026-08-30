# Wizzy onchain architecture

Status: deferred. The implementation remains available for later review, but the current product uses centralized, version-controlled curation and must not deploy or sync this registry.

## Decision

Wizzy already submits each destination-chain allocation as one atomic wallet approval. The product calls `wallet_sendCalls` with `atomicRequired: true`; Privy implements this with EIP-7702 and a Kernel smart account. The approval, swaps, LP mints, and service-fee transfer either all succeed or all revert.

Do not fork Revert Finance to solve index entry. Revert's Auto-Compound, Auto-Range, and Auto-Exit contracts automate an LP NFT after it exists. They do not replace the allocation plan, and their operator approvals would add a separate authority surface. Wizzy can study or fork those automators later for the three post-mint jobs while keeping the LP NFT in the user wallet.

The public MIT-licensed `revert-finance/v3utils` repository contains Auto-Range and Auto-Exit implementations. The public MIT-licensed `revert-finance/compoundor` repository contains the deprecated custodial Compoundor and SelfCompoundor. The Revert organization did not expose the current v3 Auto-Compound implementation in its public repository list when checked on 2026-08-30, so that component cannot be assumed forkable without separate source or permission.

Cross-chain entry still requires a destination-chain action after Relay fills. EIP-5792 batches calls on one chain; it cannot make an asynchronous bridge plus destination execution one atomic transaction. A destination receiver contract could automate that second action later, but it would need tightly constrained calldata, refund behavior, bridge authentication, and an audit before receiving user funds.

## Deferred onchain index registry

If activated in a later release, the legacy-named `UnaIndexRegistry` contract could provide an onchain snapshot for the Robinhood Wizzy Index:

- The full index is replaced atomically; partial updates are impossible.
- Weights must total exactly 10,000 basis points.
- Market IDs are unique and every token, pool, fee, tick spacing, range width, and weight is validated.
- The registry is permanently bound to the chain's canonical Uniswap v3 factory and WETH. A publish reverts unless the factory recognizes the exact token/WETH pool and its fee tier maps to the supplied tick spacing.
- Each publish names the version it read, preventing a stale curator run from overwriting a newer snapshot.
- Each version anchors the curator report with a nonzero evidence hash and an optional bounded URI.
- The curator can pause deposits immediately. Only the owner can unpause.
- Owner and curator rotations are two-step transfers so a mistyped address cannot seize authority.
- The contract stores the current snapshot; events preserve the version history for indexers and audits.

The proposed deployment owner and curator are the same dedicated Wizzy EOA: `0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42`. The funded wallet is not needed for centralized curation and should remain untouched while the registry is deferred.

Every six-hour curator run currently produces evidence and one of three recommendations: no change, a policy-valid whole-index replacement proposal, or an immediate review on a hard security failure. The curator agent applies approved changes to `src/config/markets.json` through the normal tested deployment path. The registry sync command remains a manual, deferred tool and is never called by the curator service.

## Threat assessment

| Threat | Control | Remaining risk |
| --- | --- | --- |
| Wizzy key compromise | Atomic validation, exact weight sum, market cap, canonical-factory pool verification, target allowlisting, and expected-version checks | The one key controls registry, treasury, and future token creation. Compromise is catastrophic; Vercel and dappnode access must remain tightly restricted and the key must never enter logs or client code. |
| Stale curator job | Expected-version check | The curator must re-read and re-evaluate after a version conflict. |
| Partial or malformed update | Whole-snapshot publish and strict field validation | Economic safety of a syntactically valid pool remains an offchain review responsibility. |
| Unbounded gas/storage | 32-market cap and 200-byte evidence URI cap | Publishing cost grows linearly with index breadth. |
| Owner address typo | Deployment uses the already-derived and independently verified treasury address | There is no second signer or recovery quorum. |
| Security incident | Curator-or-owner pause; owner-only unpause | Existing positions remain exposed to their underlying pools; pause only stops Wizzy from treating the registry as depositable. |
| Backend censorship or drift | Product reads the versioned contract state and report hash | RPC availability and chain reorgs still require normal client retry/finality handling. |

## Future activation gates

Before deployment:

1. Independently review and fuzz the registry.
2. Fund the dedicated Wizzy address and deploy with that same address as owner and curator.
3. Publish the curator-derived initial snapshot and verify it on Blockscout.
4. Configure `UNA_INDEX_REGISTRY_ADDRESS`, switch planning and UI reads to the registry, and fail closed when it is paused or unavailable.
5. Run one canary deposit and compare every minted position with the registry version shown at signing.

Mainnet deployment is not part of the current plan. Deployment and each snapshot publication would consume Robinhood Chain gas; funding the dedicated address does not activate or authorize either action. If the registry is reconsidered, refresh the estimate and complete every gate above before requesting explicit deployment approval.

`bun run registry:deploy` estimates the current transaction and predicted address without broadcasting. `bun run registry:deploy -- --live` refuses a signer other than the configured Wizzy treasury, refuses an underfunded address, deploys owner and curator as that same address, and verifies the receipt address. After deployment, set the legacy-compatible `UNA_INDEX_REGISTRY_ADDRESS` and run `bun run registry:sync` before using `--live`.

## Primary references

- Privy batch transactions: https://docs.privy.io/recipes/batch-transactions
- EIP-5792 wallet call API: https://eips.ethereum.org/EIPS/eip-5792
- Revert v3utils: https://github.com/revert-finance/v3utils
- Revert Compoundor: https://github.com/revert-finance/compoundor
