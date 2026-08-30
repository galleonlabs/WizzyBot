# Una onchain architecture

Status: implementation complete locally; deployment intentionally not authorized.

## Decision

Una already submits each destination-chain allocation as one atomic wallet approval. The product calls `wallet_sendCalls` with `atomicRequired: true`; Privy implements this with EIP-7702 and a Kernel smart account. The approval, swaps, LP mints, and service-fee transfer either all succeed or all revert.

Do not fork Revert Finance to solve index entry. Revert's Auto-Compound, Auto-Range, and Auto-Exit contracts automate an LP NFT after it exists. They do not replace the allocation plan, and their operator approvals would add a separate authority surface. Una can study or fork those automators later for the three post-mint jobs while keeping the LP NFT in the user wallet.

The public MIT-licensed `revert-finance/v3utils` repository contains Auto-Range and Auto-Exit implementations. The public MIT-licensed `revert-finance/compoundor` repository contains the deprecated custodial Compoundor and SelfCompoundor. The Revert organization did not expose the current v3 Auto-Compound implementation in its public repository list when checked on 2026-08-30, so that component cannot be assumed forkable without separate source or permission.

Cross-chain entry still requires a destination-chain action after Relay fills. EIP-5792 batches calls on one chain; it cannot make an asynchronous bridge plus destination execution one atomic transaction. A destination receiver contract could automate that second action later, but it would need tightly constrained calldata, refund behavior, bridge authentication, and an audit before receiving user funds.

## Onchain index registry

`UnaIndexRegistry` is the canonical current snapshot for the Robinhood Una Index:

- The full index is replaced atomically; partial updates are impossible.
- Weights must total exactly 10,000 basis points.
- Market IDs are unique and every token, pool, fee, tick spacing, range width, and weight is validated.
- The registry is permanently bound to the chain's canonical Uniswap v3 factory and WETH. A publish reverts unless the factory recognizes the exact token/WETH pool and its fee tier maps to the supplied tick spacing.
- Each publish names the version it read, preventing a stale curator run from overwriting a newer snapshot.
- Each version anchors the curator report with a nonzero evidence hash and an optional bounded URI.
- The curator can pause deposits immediately. Only the owner can unpause.
- Owner and curator rotations are two-step transfers so a mistyped address cannot seize authority.
- The contract stores the current snapshot; events preserve the version history for indexers and audits.

The intended ownership topology is a multisig owner and a dedicated low-balance curator publisher. The publisher key can update membership and weights or pause. It cannot transfer ownership, rotate itself, or resume a paused registry.

## Threat assessment

| Threat | Control | Remaining risk |
| --- | --- | --- |
| Curator key compromise | Atomic validation, exact weight sum, market cap, canonical-factory pool verification, owner-controlled curator rotation, immediate pause | A compromised curator can still select a genuine but economically bad pool until the owner pauses; deployment should add a timelock or owner co-sign if responsiveness permits. |
| Stale curator job | Expected-version check | The curator must re-read and re-evaluate after a version conflict. |
| Partial or malformed update | Whole-snapshot publish and strict field validation | Economic safety of a syntactically valid pool remains an offchain review responsibility. |
| Unbounded gas/storage | 32-market cap and 200-byte evidence URI cap | Publishing cost grows linearly with index breadth. |
| Owner address typo | Two-step ownership and curator transfers | Multisig signer policy remains operational, not contractual. |
| Security incident | Curator-or-owner pause; owner-only unpause | Existing positions remain exposed to their underlying pools; pause only stops Una from treating the registry as depositable. |
| Backend censorship or drift | Product reads the versioned contract state and report hash | RPC availability and chain reorgs still require normal client retry/finality handling. |

## Activation gates

Before deployment:

1. Independently review and fuzz the registry.
2. Select the Robinhood Chain multisig owner and dedicated curator publisher.
3. Decide whether curator publishes should be immediate or timelocked.
4. Publish the initial six-market snapshot from `src/config/markets.json` and verify it on Blockscout.
5. Configure `UNA_INDEX_REGISTRY_ADDRESS`, switch planning and UI reads to the registry, and fail closed when it is paused or unavailable.
6. Run one canary deposit and compare every minted position with the registry version shown at signing.

Mainnet deployment spends funds and creates durable public state, so it requires explicit approval of the chain, owner, curator, and transaction cost.

## Primary references

- Privy batch transactions: https://docs.privy.io/recipes/batch-transactions
- EIP-5792 wallet call API: https://eips.ethereum.org/EIPS/eip-5792
- Revert v3utils: https://github.com/revert-finance/v3utils
- Revert Compoundor: https://github.com/revert-finance/compoundor
