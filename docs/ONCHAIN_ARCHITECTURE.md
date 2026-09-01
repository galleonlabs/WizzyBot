# Wizzy onchain architecture

Status: current. Wizzy prepares one reviewed market position at a time for an external EOA. The version-controlled catalog is the only curation authority.

## Decision

Wizzy prepares the selected market for the connected EOA. When the wallet supports EIP-5792, the product calls `wallet_sendCalls` with atomic execution required. The approvals, swap, LP mint, and service-fee transfer then succeed or revert together. A wallet without atomic batching receives the same allowlisted steps sequentially and sees each approval before it is sent.

Do not fork Revert Finance to solve market entry. Revert's Auto-Compound, Auto-Range, and Auto-Exit contracts automate an LP NFT after it exists. They do not replace the transaction plan, and their operator approvals would add a separate authority surface. Wizzy can study those automators for post-mint jobs while keeping the LP NFT in the user wallet.

The public MIT-licensed `revert-finance/v3utils` repository contains Auto-Range and Auto-Exit implementations. The public MIT-licensed `revert-finance/compoundor` repository contains the deprecated custodial Compoundor and SelfCompoundor. The Revert organization did not expose the current v3 Auto-Compound implementation in its public repository list when checked on 2026-08-30, so that component cannot be assumed forkable without separate source or permission.

Cross-chain funding still requires a destination-chain action after Relay fills. EIP-5792 batches calls on one chain; it cannot make an asynchronous bridge plus destination execution one atomic transaction. Wizzy therefore sends bridged ETH to the same connected wallet and prepares the market action only after funds arrive.

## Archived registry experiment

`UnaIndexRegistry` and its deployment scripts are retained only as test history. They are not part of the product direction, the curator workflow, or the consumer app. Production must not configure `UNA_INDEX_REGISTRY_ADDRESS`, read the deployed test instance, publish market weights, or prompt users to migrate into a curator-defined basket.

## Primary references

- EIP-5792 wallet call API: https://eips.ethereum.org/EIPS/eip-5792
- Revert v3utils: https://github.com/revert-finance/v3utils
- Revert Compoundor: https://github.com/revert-finance/compoundor
