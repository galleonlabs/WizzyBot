# Revert — three jobs, user-held NFT, Base automators

Last verified: 29 Aug 2026.

Sources (official):

- Auto-compounder: https://docs.revert.finance/revert/auto-compounder
- Auto-range: https://docs.revert.finance/revert/auto-range
- Auto-exit: https://docs.revert.finance/revert/auto-exit
- Auto-compounder user guide: https://docs.revert.finance/revert/auto-compounder/user-guide
- Auto-compounder v1 FAQ: https://docs.revert.finance/revert/resources/auto-compounder-v1-faq
- Auto-range technical: https://docs.revert.finance/revert/technical-docs/auto-range
- Auto-exit technical: https://docs.revert.finance/revert/technical-docs/auto-exit
- Contract addresses: https://docs.revert.finance/revert/resources/contract-addresses
- Compoundor whitepaper: https://hackmd.io/@revert/BJcGIJQ35
- Aerodrome Lend post-mortem 30 Jan 2026: https://paragraph.com/@revertfinance/post-mortem-aerodrome-lend-vault-incident-on-base

## 1. The three jobs

Revert LP product (ignoring Lend) is three automations on a Uniswap v3 NFT:

| Job | What it does | Fee (docs) |
| --- | --- | --- |
| Compound | Collect uncollected fees, optionally swap to the range ratio, add back as liquidity | 2% of compounded fees |
| Range (Auto-Range) | When price is out-of-range by a user-set percent, withdraw and mint a same-width range centered on current price | 0.15% of position assets OR 2% of uncollected fees |
| Exit (Auto-Exit) | When pool price hits a configured tick/price, withdraw (optional swap to one token) | Same 0.15% / 2% choice |

That triad is the whole UnaBot v1 job list. Do not add leverage, gauges, or lending.

## 2. User-held NFT (v3 automators)

**v3 Auto-Compound / Auto-Range / Auto-Exit keep the NFT in the user wallet.**

Activation is an **operator approval**, not a transfer:

- Auto-compound user guide: wallet prompt sets the auto-compounder as operator. User can still add/remove liquidity, collect fees, or self-compound. Stop = clear the operator.
- Auto-range technical: approve with setApprovalForAll (required so newly minted replacement NFTs stay approved) and call configToken().
- Auto-exit technical: approve or setApprovalForAll, then configToken(). Clear config to remove.

**v1 Compoundor (deprecated) is the opposite:** user transfers the NFT into the Compoundor contract. Only the original owner can withdraw liquidity; anyone can collect-and-redeposit for a 2% reward. FAQ: you transfer it to the Compoundor contract and can withdraw anytime but the NFT is contract-owned.

**UnaBot copies the user-held model, not v1 custody.** Product line: You keep the position. No vault custody.

## 3. v3 vs v1 Compoundor

| | v1 Compoundor (deprecated) | v3 Auto-Compound |
| --- | --- | --- |
| NFT location | Transferred into Compoundor | Stays in user wallet |
| Who can trigger | Anyone (autoCompound) | Operator account (Revert bots); owner can self-compound |
| Self-compound fee | 0% if the owner calls | Owner can still manage / self-compound (UnaBot: --no-fee) |
| Reward | 2% of compounded fees, only decreasable | 2% (MAX_REWARD_X64 = Q64/50) |
| Base address | 0x4a8c2bdf0d8d2473b985f869815d9caa36a57ee4 (deprecated) | 0x0bf485bd7ebb82e282f72e7d14822c680e3f7bec |
| Why v1 is a must-not | Vault-shaped custody; one contract holds many NFTs | Matches user holds the NFT |

v1 FAQ documents the 2% and the only-decreased-never-increased governance bound. That bound is a good UnaBot invariant for FEE_TIER.compoundBps.

v1 also documented the keeper economic trigger: compound when unclaimed fees are about 100x gas. Use as a default heuristic, not a promise. UnaBot minFeeUsd (config default $1) is the operator-facing knob.

## 4. Official Base automator addresses

From https://docs.revert.finance/revert/resources/contract-addresses (fetched 29 Aug 2026).

### Uniswap-side v3 automators on Base (match UnaBot jobs)

| Job | Contract | Address |
| --- | --- | --- |
| Auto-Range v3 | Auto-Range v3 | 0xa8549424b20a514eb9e7a829ec013065bef9dc1d |
| Auto-Exit v3 | Auto-Exit v3 | 0x16e0b91ce6f1c426df6e2a5a295d113e8f596a93 |
| Auto-Compound v3 | Auto-Compound v3 | 0x0bf485bd7ebb82e282f72e7d14822c680e3f7bec |
| V3Utils v1.1 | utils | 0x5b2f7cc65f8eb6222289c714547b9ab22db86be5 |
| Selfcompoundor | self-compound | 0xc5d8fa6439a5a8caa4ab24025751255296f1551a |
| Compoundor v1 (deprecated) | vault-style | 0x4a8c2bdf0d8d2473b985f869815d9caa36a57ee4 |
| V4Utils | v4 helper | 0x209E399ac7FC8747c3821F9376E4eb6Ce105DbA8 |

Deprecated Auto-Range v2 / Auto-Exit v2 / AutoRange / AutoExit / V3Utils v0 addresses exist on the same page. Do not integrate them.

### Aerodrome-on-Base automators (do not use in UnaBot v1)

Listed so we do not confuse them with the Uniswap v3 set. These sit under Aerodrome on Base on the same page:

| Contract | Address |
| --- | --- |
| Auto-Range / Auto-Compound (Aero) | 0xEB6127DcFB1E4107Dc1F3111151f779920c213Dd |
| Auto-Exit (Aero) | 0xc35e20379C3267B5f63E569c25959031aC588203 |
| V3Vault (Aero Lend, relaunch-era) | 0x1EF7C181188687e20A9750714f1b9DE6F70f17C0 |
| GaugeManager | 0xc171F8c6ED8253151DE50ab839E3A468028113F2 |
| V3Utils (Aero) | 0x2309A5aE06e86986a6f27b81a53cC31Fc1B55b0a |

Aero auto-compound reinvests AERO emissions, not swap fees. Different mechanics, different fees. Out of scope.

Revert Lend Uniswap-v3 vault on Base (0x36AEAe0E411a1E28372e0d66f02E57744EbE7599) is also out of scope.

## 5. Fee details (range / exit)

Both Auto-Range and Auto-Exit ask the user to pick a fee source:

1. **Position assets (notional).** Protocol take 0.15%. Anything the user configures above 0.15% is a gas budget for the operator. If the budget is too small vs gas at execution time, the job does not fire. Surplus on Auto-Exit is returned to the wallet; surplus on Auto-Range is reused as capital in the next mint.
2. **Uncollected fees.** Protocol take 2% of uncollected fees at execution. Configured percent must exceed 2% plus a gas cushion. Surplus returned (exit) or reused (range).

TWAP: both contracts check the pool TWAP before a swap to block price manipulation. Revert bots source swaps from 0x, subject to the user max price-impact.

Left-overs: a re-range cannot hit the exact token ratio; dust is sent to the position owner in the same tx. Operators are paid from tokens successfully added (range) or swapped (exit).

**UnaBot fee schedule mirrors this exactly** (see product.md and src/constants.ts): compound 2% of compounded fees; range/exit default 2% of uncollected fees, optional 0.15% notional via --fee-source notional|fees. --no-fee is the owner self-compound / self-range path (v1 Compoundor charged 0% when the owner called).

## 6. January 2026 Aerodrome Lend incident (team funds)

Official post-mortem: Revert, 30 Jan 2026, All user funds are safe.

Facts from that page:

- Aerodrome Lend on Base was announced 29 Jan 2026. A few hours later the new vault was exploited.
- **Loss: about 50,101.744193 USDC, 100% Revert team / protocol-owned capital.** No third-party user deposits were in the pool.
- Two txs on 30 Jan 2026 (UTC): block 41475479 about 02:31 (49,000 USDC) and block 41477209 about 03:29 (1,101.744193 USDC), different attacker addresses.
- Only the Aerodrome Lend vault on Base was affected. Other Revert vaults/products were not.
- Root cause: a staking/management execution path (GaugeManager + V3Utils) let the position owner withdraw liquidity from a collateralized, staked NFT, leaving the vault holding an empty NFT while the loan stayed open. Flash-loan mint, deposit, borrow, stake, transform-withdraw, repay flash loan.
- Emergency multisig disabled new deposits/borrows. Three prior audits (Cantina, PeckShield, HYDN) did not catch the end-to-end invariant gap.
- Incident-era contracts named in the post-mortem (first Aero Lend deployment, later replaced — do not treat as current): Vault 0x22CE292d882C7799183949509B011512352454cB, GaugeManager 0x66a2481b784Cf26103441cA6067F997f90d3E129, V3Utils 0x7D1F9FC22bed0798cda3fdb18b14a96fc838B9E1.

**Why this is in the UnaBot corpus:** it is the concrete reason v1 says no Revert Lend, no Aerodrome, no vault custody. The bug was not Uniswap v3 is unsafe. It was an NFT that is simultaneously collateral, staked, and transformable. UnaBot never takes the NFT and never lends against it.

A later Revert post (Aerodrome Lend relaunches on Base) lists a new vault 0x1EF7C181188687e20A9750714f1b9DE6F70f17C0. Still out of scope.

## 7. v1 must-haves (steal these, not the brand)

1. Three jobs only: compound, re-range same width, exit at price.
2. User holds the NFT. Operator approval, never safeTransferFrom into UnaBot.
3. 2% / 0.15%-or-2% fee schedule with owner --no-fee self-path.
4. TWAP + slippage + cooldown + min-fee-vs-gas before a keeper fires.
5. setApprovalForAll (or per-token approve) + config, not a vault deposit, to arm a position.
6. Re-range mints a new tokenId. Track the successor; do not assume the imported id lives forever.
7. Do not take a lending / gauge / transform path. That is how the Jan 2026 hole opened.
8. Do not run Aerodrome Slipstream. Different NPM, different gauge, different reward token.
9. Self-compound must work if the operator is down — owner calls the same function and pays gas, no product fee.
10. Honest PnL. Revert UI shows fee APR vs HOLD / divergence. UnaBot position card does the same. No no-IL claim.

## 8. Open items

- Revert Auto-Range technical page says approved for the Auto-Exit contract in the activate paragraph — likely a docs copy-paste. The Auto-Range product page is the fee/behavior source; the v3 Auto-Range address is the one in the table above.
- Confirm whether UnaBot should ever call Revert on-chain automators vs reimplementing the three jobs with the Uniswap LP API. Current product: reimplement, do not take a Revert operator dependency.

