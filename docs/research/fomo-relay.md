# Fomo and Relay — chain abstraction without custody

Last verified: 29 Aug 2026.

Sources:

- Fomo: https://fomo.family/
- Fomo wallet architecture: https://fomo.family/blog/learn/fomo-security-wallet-architecture
- Privy on Fomo: https://www.privy.io/blog/fomo
- Relay case study: https://www.relay.link/blog/how-fomo-built-crosschain-trading-using-relay
- Relay call execution: https://docs.relay.link/use-cases/calling
- Relay quickstart: https://docs.relay.link/references/api/quickstart
- Relay gasless execution: https://docs.relay.link/features/gasless-execution
- Relay wallet detection: https://docs.relay.link/references/api/api_core_concepts/wallet-detection

## Product lesson

Fomo treats chain abstraction as a product surface, not a chain selector. Users get one embedded, self-custodial wallet and a spending balance; Relay handles route selection, conversion, bridge execution, and destination fees. Fomo adds social feed, leaderboards, alerts, one-click actions, and easy fiat funding around that core.

Una should copy the abstraction, not the trading behavior: users choose a portfolio goal and see a coherent Base/Robinhood allocation. Chain rails remain visible in the transaction preview and portfolio breakdown because LP ownership and follow-up actions are chain-specific.

## What Relay supports now

Relay's live chain registry reported both Base (8453) and Robinhood Chain (4663) enabled. A live read-only quote for native ETH from Base to Robinhood returned one Base deposit transaction, an expected two-second fill, a request ID for monitoring, an explicit minimum destination amount, and separate relayer fees. No transaction was broadcast.

For a standard EOA, Relay's permissionless bridge path still needs origin gas. Arbitrary destination calls can be quoted, but calls that rely on the user as `msg.sender` require a smart account to preserve that identity. Sponsored gasless execution is an enterprise feature requiring an API key, funded app balance, and partner configuration.

## Launch contract

Una's permissionless both-chain path uses two wallet confirmations from one Base balance:

1. One atomic Base batch funds the Base LPs and sends the Robinhood share to Relay.
2. Una monitors the Relay request ID.
3. After success, one atomic Robinhood batch mints the Robinhood LPs directly to the same user wallet.

The Robinhood allocation is sized from Relay's minimum output minus an explicit native gas reserve. A better fill remains in the user's wallet. Relay's fee is disclosed separately from Una's allocation fee.

Do not advertise a one-confirmation both-chain path until the actual Privy wallet is verified with Relay EIP-7702 destination calls, dynamic token leftovers cannot become stranded at an execution proxy, and sponsorship terms are configured in production. That path is a capability gate, not launch copy.

## AI role

The best AI use is not custody. Una's scout consumes deterministic catalog and market evidence, explains why a pool is included, flags thin liquidity or unstable fee pace, and proposes a review. A reviewed config change remains the only way to alter executable markets or weights. The user sees and signs the resulting deterministic transaction plan.
