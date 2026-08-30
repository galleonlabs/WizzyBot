# UnaBot product thesis, fees, surfaces, threat model

Last verified: 29 Aug 2026 against README.md, src/constants.ts, and this corpus.

## 1. One-sentence position

UnaBot. Uniswap LP on autopilot. v2, v3, and v4. You keep the position. Compound, re-range, exit.

Not a trading desk, not an Aerodrome yield vault, not a bot that silent-signs from X.

## 2. What it is

- A local agent + keeper for **Base (8453)** Uniswap v2, v3, and v4 positions.
- The position stays in the user wallet. UnaBot never safeTransferFroms it into a vault.
- Writes go through the official Uniswap LP API (https://liquidity.api.uniswap.org) when an API key is present, or through SDK + viem calldata when it is not. Swaps (rebalance legs only) use https://trade-api.gateway.uniswap.org/v1.
- Default is **dry-run**. --live broadcasts and requires typing yes.

Treasury (all product fees): 0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42 (TREASURY in src/constants.ts). Optional override: UNABOT_TREASURY.

## 3. What it is not

| Not | Why |
| --- | --- |
| A trading desk | No market-making, no perps, no Polymarket, no tokenized stocks, no buy 5 of X. Rebalance swaps exist only to restore the range ratio. No extra swap take. |
| Aerodrome yield | Different NPM, gauges, AERO emissions. Revert Jan 2026 hole lived on that stack. Out of scope. |
| A Revert clone that takes the NFT | We copy Revert jobs and fees, not v1 Compoundor custody and not Lend. |
| Silent-sign from X | Bankr May 2026. No social scanner that can reach the signer. Chat is local CLI / MCP. |
| A no-IL product | Concentrated liquidity diverges from HOLD. The position card must show it. |
| A Virtuals launchpad | Tokenizing the agent is a later step (virtuals.md). This repo does not deploy a token. |

## 4. Fee schedule

Mirrors Revert published numbers. Encoded in src/constants.ts as FEE_TIER.

| Action | Default take | Alternate | Recipient |
| --- | --- | --- | --- |
| Auto-compound | 2% of compounded fees (compoundBps = 200) | --no-fee owner self-compound = 0% | Treasury |
| Auto-range | 2% of uncollected fees (rangeExitFeeBps = 200) | --fee-source notional -> 0.15% of position notional (notionalBps = 15) | Treasury |
| Auto-exit | Same as auto-range | Same | Treasury |
| Rebalance swap | None | — | Pool fee only |

No Bankr-style user-swap fee. The stale 0.8% figure must not appear in UnaBot pricing.

Keeper should skip when fees do not cover gas + take (minFeeUsd, default $1; Revert v1 heuristic was about 100x gas). spendCapUsd (default 10_000) and maxPriceImpactBps (default 50) bound a live run.

## 5. Surfaces

| Surface | Entry | Notes |
| --- | --- | --- |
| CLI | unabot list / import / status / pool / mint / compound / range / exit / simulate / run / chat / mcp / config | Also unabot "status 12345" NL |
| Keeper | unabot run | Loop over policy; log skip / execute |
| MCP | stdio JSON-RPC | pool_info, position_list, position_pnl, quote_mint, create, increase, decrease, claim, compound, rebalance, exit, simulate |
| Skill | skills/unabot-lp/SKILL.md | For Cursor / Claude Code / other skills hosts |
| Config | ~/.unabot/config.json merged with ./unabot.config.json | Per-tokenId rules |

Global flags: --live, --no-fee, --fee-source fees|notional.

Env: BASE_RPC_URL (default https://mainnet.base.org), UNISWAP_API_KEY, UNABOT_PRIVATE_KEY (never logged), UNABOT_TREASURY, UNABOT_ETH_USD.

Without an API key the agent still does full read / PnL / dry-run and builds calldata locally.

## 6. Jobs

1. Import existing v2 / v3 / v4 positions (user already owns them).
2. Position card: in-range, fee APR, total APR vs HOLD, divergence, uncollected.
3. Mint with tick snap (show adjusted bounds).
4. Compound when fees >> gas.
5. Re-range same width when out-of-range by user percent (oorPercent; 0 = only fully OOR).
6. Exit at price.
7. Policy file + keeper loop (cooldown, spend cap, min position USD).
8. CLI + MCP + SKILL.md + NL chat.
9. Dry-run default; --live requires key + typed yes.
10. You keep the position.

## 7. Threat model

### Assets

- The Uniswap position (principal + uncollected fees) in the user wallet.
- The hot signer key (UNABOT_PRIVATE_KEY) that --live uses.
- The Uniswap API key (quote + calldata; not custody, but a billing / rate-limit / integrator-fee handle).
- Policy files on disk (they authorize what the keeper will sign).

### Actors

- The operator who runs --live (trusted with the EOA).
- A leaked key / compromised host.
- A malicious or confused LLM sitting on unabot chat or MCP (prompt injection).
- A pool / hook / token with non-standard ERC-20 behavior.
- A future social surface (read-only status is fine; a signer on X is not).

### Boundaries that must hold

1. UnaBot never takes the position. No deposit into a Compoundor, vault, or strategy contract. Operator-style approvals of NFPM to Uniswap contracts are fine; approvals to UnaBot-the-contract do not exist because there is no such contract.
2. Signer allowlist: NFPM, Permit2, Universal Router, treasury, plus the position tokens for the in-flight fee/approval. A leaked key can still drain allowlisted targets — say that out loud.
3. Dry-run is default. Live requires --live and a typed yes. MCP tools that would broadcast must honor the same gate.
4. The LLM is not an authorizer. Natural language may propose a plan; the policy file + allowlist + --live confirmation authorize it. A prompt that says send the NFT to an attacker address must fail the allowlist.
5. No social ingress that can reach the signer. If a later surface exists, it can report (status, PnL) but must not broadcast. Bankr 4 May and 19 May 2026 are the worked examples.
6. Quotes go stale. Slippage and TWAP are backstops, not guarantees. Refetch before broadcast; 30s freshness is the LP guide example.
7. No Aerodrome / Lend path. v4 hooks and gauge-transform flows are how the NFT still exists but the value is gone happens. Review hooks before entering a hooked pool.
8. Fee-on-transfer / rebase tokens are unsupported (Revert states this; we inherit it).
9. API key stays off the client. A leaked key cannot steal the position; it can burn rate limit or, if we ever set integratorFee, redirect a swap take. Do not put the key in a browser skill.
10. Treasury is a fee sink, not a custodian. Users should never send the position or principal to 0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42.

### Residual risk (accepted)

- Whoever can run --live on the box is the custodian of that EOA.
- A stolen laptop with UNABOT_PRIVATE_KEY and an already-approved NFPM can compound / range / exit against the user position if setApprovalForAll was granted to a router the attacker can also call. Mitigation: least-privilege approvals, spend cap, cooldown, and do not leave --live enabled in a daemon without a policy spend cap.
- MCP hosts (Cursor, Claude) see tool output. Do not log private keys or full signed payloads.

## 8. 10-line product thesis

1. UnaBot is Uniswap LP on autopilot; the user holds the position.
2. The product is three jobs — compound, re-range, exit — not a DEX front-end.
3. Fees are Revert-shaped (2% compound; 0.15% notional or 2% of fees on range/exit) and settle to treasury.
4. Surfaces are CLI, local NL, MCP, and a skill — Bankr good shape without Bankr social signer.
5. v2, v3, and v4. v3 NFTs are enumerable; v4 hooks are untrusted code until reviewed; v2 fees are realized via decrease.
6. Official Uniswap LP + Trading APIs at 6 RPS, x-api-key, no integrator swap take.
7. Virtuals (1% tax, 70/30, 42k graduation, 10y lock) is how the agent may later fund itself; creator wallet = treasury.
8. We do not silent-sign from X; May 2026 is the corpus, not a vibe.
9. We do not take Aerodrome or Lend; January 2026 is why.
10. Dry-run default, allowlisted signer, policy file, honest divergence vs HOLD.

## 9. Open product questions (speculation)

- Whether a hosted read-only status bot on X is worth it without a signer. Fine to discuss; not a commit.
- Whether a v4 path should whitelist a single unhooked ETH/USDC pool before any hooked pool.
- Whether to add an integratorFee on non-LP swaps. Default no.
