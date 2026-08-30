# Bankr — what to copy, what to skip

Last verified: 29 Aug 2026.

Sources (official unless marked):

- Docs ingest: https://docs.bankr.bot/llms-full.txt
- Token launch overview + fee table: https://docs.bankr.bot/token-launching/overview/
- Claiming fees: https://docs.bankr.bot/token-launching/claiming-fees/
- Club / access: docs.bankr.bot Access page in llms-full.txt; help https://help.bankr.bot/article/bankr-club-and-max-mode
- Swap costs (current): https://help.bankr.bot/article/how-to-trade
- Skills org: https://github.com/BankrBot/skills
- Token-deployment skill: https://github.com/BankrBot/skills/blob/HEAD/bankr/references/token-deployment.md
- May 2026 incidents: SlowMist via cryptotimes.io 2026-05-07; valens.me/writing/wallet-prompt-injection-bankr-base-incident; chainward.ai/decodes/bankr-hack-trace


## 1. What Bankr is

Bankr is a **web-native agent runtime with a wallet**, not an LP manager. Official positioning: financial rails for self-sustaining AI agents (wallet, launch a token, trading fees, pay LLM compute).

Useful surface reference (CLI + skill + chat + API) and useful negative reference (silent-sign from X, auto-provisioned social wallets, Club NFT as a privilege grant).

## 2. Product surfaces

One agent, one wallet-scoped state, many clients (llms-full.txt).

| Surface | How |
| --- | --- |
| Web terminal | https://bankr.bot |
| X / Twitter | @bankrbot |
| Telegram | @bankr_ai_bot |
| CLI | @bankr/cli package; bankr agent prompts |
| Agent API | api.bankr.bot/agent/prompt with X-API-Key header |
| Claude plugins | BankrBot/claude-plugins marketplace |
| Skill for other agents | github.com/BankrBot/skills |

Also shipped: persistent filesystem, /.memory/ prefs, automations (limit/stop/DCA/TWAP/agent-command), MCP per wallet, x402, Apps, browser automation.

Chains: Base (primary), Ethereum, Polygon, Unichain, World Chain, Arbitrum, BNB, Solana, Hyperliquid, Robinhood Chain. Gas sponsored on Base, Polygon, Unichain, World Chain, BNB; limited on Solana; not on Ethereum or Arbitrum.

## 3. Club pricing (current docs)

From llms-full.txt Access page. Help center still says unlimited terminal messages for Club while the docs table says 1,000 msgs/day; prefer the docs table.

| | Free | Bankr Club | Max Mode |
| --- | --- | --- | --- |
| Cost | $0 | $20/mo or $198/yr in USDC (default) or BNKR / ETH / any Base ERC-20 | Pay-per-token from LLM credits |
| Messages/day | 5, terminal only, UTC midnight reset | 1,000 | Unlimited (credits) |
| Model | Gemini Flash | Gemini 3 Flash | Any gateway model |
| Token launches / browser / apps / @bankrbot on X | No | Yes | Yes |

Notes: Club checkout requires a Bankr embedded (Privy) wallet. External MetaMask / Coinbase / SIWE wallets cannot subscribe; they use Max Mode. Original Bankr Club NFT from the initial drop is commemorative and does not grant membership. Agent API: 1,000 requests/day for Club vs 100/day for non-members (help article). Storage: Free 1 GB / 10 MB file / 10 GB monthly download; Club 10 GB / 50 MB / 100 GB. Automations: Standard 5 active / 100 max exec / 24 daily runs; Club 20 / 1,000 / 100.

## 4. BNKR contract

Official pairedTokenAddress on Base, from token-launching overview:

**0x22af33fe49fd1fa80c7149773dde5890d3c76f3b**

Checksum commonly written 0x22aF33FE49fD1Fa80c7149773dDe5890D3c76F3b. Same 20 bytes. Also used as an optional quote token for Base launches (alongside ba3Pump 0x5577a294ae5a21446a11b0e4100ca83803995720).

## 5. Doppler launch fee table (current) — 1.75% all-in

Current Bankr launches create a Uniswap v4 pool via Doppler. Fixed supply 100 billion, not mintable after deploy. Pool swap fee 0.7%, of which 95% goes to the creator (= 0.665% of volume). Hooks add the rest. All-in 1.75% of volume.

| Recipient | Share of volume |
| --- | --- |
| Creator — 95% of the 0.7% pool fee, claim anytime | 0.665% |
| LP fee (hook) — compounds as permanently locked liquidity in the token own pool | 0.285% |
| Bankr protocol fee (hook) | 0.475% |
| BNKR buyback (hook) | 0.2375% |
| Protocol (Doppler) | ~0.0875% |

0.665 + 0.285 + 0.475 + 0.2375 + 0.0875 = 1.75.

Creator-side (claimable 0.665 + locked LP 0.285) = 0.95% of volume. Fee schedules are fixed at launch and never change retroactively. Older tokens keep the hook schedule they launched with; the 95%-of-0.7% creator leg is the same.

Deploy caps (overview): Standard 50 tokens/day, Club 100/day; at most one deploy per minute. Gas sponsored for first 3 deploys/day (Standard) or 10/day (Club).

## 6. The 0.8% user-swap fee is stale

Older Bankr marketing (Paragraph finally crypto fees that dont suck) and third-party reviews still say 0.8% per swap on user trades, with a cut to BNKR buybacks.

**Current official swap-cost page does not list a 0.8% Bankr user-swap fee.** https://help.bankr.bot/article/how-to-trade (fetched 29 Aug 2026) says: gas sponsored on most chains; pool fees are whatever the DEX pool charges, shown in the quote; Bankr-launched tokens carry the 1.75% all-in Doppler/Clanker schedule with no other fees on those trades; anti-snipe elevated fee if you buy within about 10 seconds of a launch.

Do not copy 0.8% into UnaBot pricing, comparisons, or pitch decks. If a competitor table still shows it, footnote it as stale 2025/early-2026 marketing.

A Feb 2026 docs.bankr.chat Zero to Earning page still describes a 1.2% / 57% creator Clanker-era schedule. That is also stale relative to the 1.75% Doppler table on docs.bankr.bot. Prefer docs.bankr.bot.

## 7. Skills org

Official skills live under https://github.com/BankrBot/skills

Install path advertised to other agents: install the bankr skill from that repo. Claude marketplace: BankrBot/claude-plugins. CLI package: @bankr/cli.

UnaBot should ship an analogous skills/unabot-lp/SKILL.md in-repo (already present) and, later, a public skills repo only if we want third-party agents to drive UnaBot. v1 does not need a Bankr-style public org.

## 8. Prompt-injection incidents (May 2026)

Two public incidents, two weeks apart. Neither was a smart-contract bug. Both are the reason UnaBot must not silent-sign from X.

### 4 May 2026 — Grok / DRB wallet

Facts that multiple post-mortems and SlowMist agree on:

- Bankr auto-provisions a wallet for every X account that talks to it, including @grok. Keys sat with Bankr custodial/Privy stack, not xAI.
- An earlier agent build had a hardcoded ignore-replies-from-Grok block after a 2025 LLM-on-LLM incident. The rewrite dropped that block.
- Attacker gifted / activated a Bankr Club Membership on that wallet, unlocking high-privilege transfer tools.
- Attacker posted Morse-encoded text at @grok. Grok decoded it and publicly replied tagging @bankrbot with a plaintext send-3B-DRB command.
- Bankr scanner treated the verified-Grok reply as an authorized instruction and signed the transfer.
- About 3 billion DRB left the wallet (about $150k-$175k at the time). Bankr later said about 80% was returned; the rest to be discussed with the DRB community.

Bankr own explanation (quoted by valens.me): the Grok wallet is controlled by whoever controls the X account, not by the Bankr team; they re-added a Grok block and shipped optional hardenings (IP allowlist on API keys, permissioned keys, per-account disable on X).

### 19 May 2026 — 14 wallets

Bankr paused transactions and said an attacker accessed 14 Bankr wallets, promised reimbursement from a >$3M treasury, and looped in the FBI. SlowMist / ChainWard described it as the same trust-layer class (agent treats a social or API prompt as authority), not a key-exfiltration of the whole fleet. Public loss figures in secondary write-ups (about $170k ETH/BNKR; three attacker addresses holding more) are third-party; treat exact USD as unconfirmed unless Bankr publishes a final number.

### Design lesson (not speculation)

The failure is authorization, not encoding. Morse vs English is irrelevant. The questions a signer must answer:

1. Is this principal allowed to move these funds?
2. To that recipient, in that amount, on that surface?
3. Did a human (or a policy file the human signed) confirm it?

A Club NFT, a public reply from a famous account, or a decoded string is not an authorization.

Bankr later docs now describe the right controls: wallet-level daily / per-tx USD caps, permitted recipients with cooldown, price-impact protection, disable-arbitrary-calls, response-channel toggles, passkey MFA, per-key readOnly / allowedIps / allowedRecipients, and a disable on X switch. Those shipped after the holes were used.

## 9. What to copy vs skip

### Copy

- CLI + NL + skill + MCP as one agent with one state. UnaBot already mirrors this at a smaller radius (unabot CLI, NL status, skills/unabot-lp, stdio MCP).
- Dry-run default; explicit live. Bankr still silent-signs some quick-buy paths from the embedded wallet — copy the idea of a confirmation boundary, not that path.
- Policy as data. Bankr /.memory/user_*.md (never confirm trades under $50) is the same job as ~/.unabot/config.json spend caps, minFeeUsd, oorPercent, cooldown.
- Scoped keys, IP allowlist, recipient allowlist, read-only default. Steal the table from Bankr API-key docs.
- Post-incident honesty. Publish a threat model (see product.md) before a social surface exists.
- llms-full.txt style docs so coding agents can ingest the product.

### Skip

- Silent-sign from X / Farcaster / Telegram. No v1 social scanner. If a later surface exists, it can report (status, PnL) but must not broadcast.
- Auto-provisioned wallet per social account. The Grok wallet existed because a reply created it.
- Custodial Privy signing of high-value transfers without a second factor. UnaBot signer is an EOA the operator already holds; we do not take that key.
- Club NFT / membership as a privilege grant that unlocks transfers.
- Trading-desk scope. Swaps, perps, Polymarket, tokenized stocks, browser checkout, x402 image gens — out of v1.
- A 0.8% (or any) user-swap fee. UnaBot takes protocol fees on compound / range / exit only.
- Aerodrome routing, Hyperliquid, Robinhood Chain. Base Uniswap v2, v3, and v4.
- Token launch in the initial application release. Any later token follows [the staged token plan](../TOKEN_FLYWHEEL.md); Bankr, Virtuals, Pools, and other providers remain unselected options until the go/no-go review.

## 10. Open items

- Bankr has not published a single canonical post-mortem URL for 19 May 2026. If they do, replace the secondary citations.
- Help-center Club copy (unlimited terminal messages) still disagrees with the docs table (1,000/day). Re-check before quoting Club in public.
