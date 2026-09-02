# Wizzy onchain architecture

Status: current. Wizzy prepares one reviewed market position at a time for an external EOA. The version-controlled catalog is the only curation authority.

## Decision

Wizzy prepares the selected market as a short sequence of allowlisted transactions for the connected EOA. The wallet shows each approval, swap, and LP mint before it is sent, and Wizzy waits for a successful receipt before moving to the next step. If a later transaction fails, completed transactions remain onchain; the wallet always owns the assets and position. Direct LP actions have no Wizzy fee because the sequence cannot enforce a fee atomically.

Do not fork Revert Finance to solve market entry. Revert's Auto-Compound, Auto-Range, and Auto-Exit contracts automate an LP NFT after it exists. They do not replace the transaction plan, and their operator approvals would add a separate authority surface. Wizzy can study those automators for post-mint jobs while keeping the LP NFT in the user wallet.

The public MIT-licensed `revert-finance/v3utils` repository contains Auto-Range and Auto-Exit implementations. The public MIT-licensed `revert-finance/compoundor` repository contains the deprecated custodial Compoundor and SelfCompoundor. The Revert organization did not expose the current v3 Auto-Compound implementation in its public repository list when checked on 2026-08-30, so that component cannot be assumed forkable without separate source or permission.

Cross-chain funding is a separate user action. Wizzy sends bridged ETH to the same connected wallet and prepares the selected market only after funds arrive on the destination chain.

## Primary references

- EIP-5792 wallet call API: https://eips.ethereum.org/EIPS/eip-5792
- Revert v3utils: https://github.com/revert-finance/v3utils
- Revert Compoundor: https://github.com/revert-finance/compoundor
