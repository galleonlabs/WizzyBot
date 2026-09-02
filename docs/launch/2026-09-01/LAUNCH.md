# Wizzy launch — 1 September 2026

## Decision

Launch from [@wizzydotmeme](https://x.com/wizzydotmeme) with the seven-post thread below and `launch-card-1600x900.png` attached to post 1.

The hook is the category: Make Meme Markets. The infrastructure and curator mechanics follow as proof. Do not lead with a fixed constituent count, custody mechanics, agents, APR, integrations, or a future token.

## Exact launch thread

### 1/7 — attach `launch-card-1600x900.png`

> Wizzy is live.
>
> Make Meme Markets.
>
> https://wizzy.meme

### 2/7

> LP fees can be attractive. The setup is not.
>
> Pick the tokens. Check the pool. Choose a fee tier and range. Bridge. Approve. Monitor. Rebalance.
>
> Wizzy turns that into one amount and one review.

### 3/7

> How it works:
>
> 1. Connect your wallet
> 2. Pick a reviewed market
> 3. Enter an ETH amount
> 4. Review the swap, range and fee
> 5. Approve each wallet transaction
>
> No vault. The LP position goes to your wallet.

### 4/7

> Wizzy starts with selected WETH markets on Base and Robinhood Chain.
>
> The curator reviews liquidity, volume, security and capacity every six hours—and updates which markets qualify as conditions change.

### 5/7

> Then Wizzy keeps the work visible: position value, unclaimed fees, range health and pool activity.
>
> Compound, rebalance or withdraw back to ETH when you choose.

### 6/7

> Built on Base and Robinhood Chain (@RobinhoodCrypto) with @Uniswap v3 and Aerodrome Slipstream. @RelayProtocol provides cross-chain funding.
>
> Constituent trade links open in @fomo.
>
> No affiliation or endorsement is implied.

### 7/7

> Wizzy starts with meme-market LPs on Base and Robinhood Chain.
>
> The direction: more protocols, more chains and the easiest LP experience for memes.
>
> LPing still carries price, range and smart-contract risk. Wizzy removes setup work, not market risk.
>
> https://wizzy.meme

The plain-text paste version is in [`thread.txt`](thread.txt).

## Why this voice

Fomo's strongest current product posts are short, product-first statements: the product comes first, the crypto machinery comes later. Uniswap's strongest posts make one category claim and immediately support it with a product, market, or volume fact. Wizzy should combine those patterns without imitating their wording:

- Post 1 makes one category claim in five words before the link.
- Post 2 names the job Wizzy removes instead of calling the experience "simple" or "seamless."
- Posts 3–5 prove how it works, which markets qualify, and what remains manageable after deposit.
- Post 6 contains every ecosystem tag. Tags do not interrupt the hook and do not imply an announced partnership.
- Post 7 states the direction without promising a chain, protocol, token, or date that has not shipped.
- There are no hashtags. The ecosystem handles and concrete nouns are more useful than `#DeFi`, `#Crypto`, or `#memecoin` spam.

### Adversarial check against the references

| Failure mode | Fomo/Uniswap pattern | Wizzy response |
| --- | --- | --- |
| Infrastructure before value | The strongest posts lead with a product outcome or category fact. | Base, Robinhood Chain, Uniswap, Aerodrome, Relay, and Fomo appear only in post 6. |
| Empty launch language | Their best posts avoid "revolutionary," "game-changing," and "thrilled to announce." | The opening names the product category directly: Make Meme Markets. |
| Too much copy | The reference posts are highly compressed. | Each post has one job; no post tries to explain the whole system. |
| Unsupported performance hook | Uniswap uses a dated historical metric when it makes a metric claim. | The thread makes no APR, return, volume, or TVL promise. |
| Tag carpet | Partner/product tags are used when the subject is directly relevant. | All relevant handles appear once in the technical proof post. |
| Token speculation | Neither reference needs an incentive promise to explain the product. | The launch does not mention a Wizzy token or airdrop. |
| False safety | Product simplicity is not the same as financial safety. | Post 7 names price, range, and smart-contract risk. |

## Graphic

- Primary attachment: `launch-card-1600x900.png` (16:9 master).
- Lightweight preview: `launch-card-1200x675.png`.
- Editable artwork: `launch-card.svg`.
- Editable render source: `render.mjs`.
- Product evidence: `product-surface.png`, captured from the live, unauthenticated product at `https://wizzy.meme` on 31 August 2026 at approximately 00:18 BST. It supports the claims but is not used as a miniature interface in the launch card.
- Official network asset: `robinhood-chain-logo-white.svg`, downloaded unchanged from Robinhood Chain's official brand asset pack.
- Alt text: **Bold dark Wizzy launch graphic reading “Make Meme Markets” beside the hooded Wizzy mascot, with the Robinhood Chain logo below.**
- Caption: no separate caption; post 1 supplies the context.

The asset is a launch billboard, not a UI screenshot. “Make Meme Markets” is its only authored text. The official white Robinhood Chain lockup is used unchanged on black, with clear space. The card does not make a fixed constituent-count, custody, performance, or forward-looking claim.

## Posting runbook — BST

### 08:30–08:50: smoke check

1. Open `https://wizzy.meme` in a signed-out tab and confirm the Make and Positions views load.
2. Confirm Pool activity shows real adds/removals and links to Robinhood Chain Blockscout.
3. Connect an external wallet and confirm the wallet control opens without clipping.
4. Check a small deposit quote through the review step. Do not broadcast solely for the smoke test.
5. Confirm the active market list loads and post 4 still accurately describes the qualification review.
6. Confirm `@RobinhoodCrypto`, `@Uniswap`, `@RelayProtocol`, and `@fomo` still resolve to the intended official accounts.

### 09:00: publish

1. Post 1 with `launch-card-1600x900.png` and the alt text above.
2. Add posts 2–7 immediately as replies so the narrative is complete before replies fragment it.
3. Pin post 1.
4. Do not add hashtags, a cashtag, a Wizzy-token hint, or extra partner logos.

### 09:05–10:30: operate the launch

1. Reply quickly to genuine product questions from the Wizzy account.
2. Ask for the failed step, wallet type, source chain, and transaction hash when someone reports a problem. Move private account details out of public replies.
3. Like or repost ecosystem amplification only when it accurately describes the live product.
4. Do not quote performance figures from the screenshot. Point people to the live Markets view for current data.
5. Log repeated objections or failures for the first post-launch patch.

## Ready replies

### Is this a vault?

> No. Wizzy prepares the transactions, but each LP position is minted to the external wallet you connected. You can manage it independently.

### Does Wizzy custody funds?

> No. Your ETH and LP positions stay in the external wallet you connected. Wizzy does not pool user deposits in a vault.

### Why these markets?

> Base and Robinhood WETH pools qualify under published liquidity, volume, age, security and capacity rules. The curator reviews the market list every six hours.

### Is there a Wizzy token?

> No token is part of this launch. The product is the LP experience.

### What can go wrong?

> LPing still has token-price, impermanent-loss, out-of-range, smart-contract and bridging risk. Wizzy reduces setup and management work; it does not remove those risks.

### Why Base and Robinhood Chain?

> Base and Robinhood Chain are EVM networks with ETH gas and active meme-market liquidity. Wizzy gives both the same reviewed, wallet-owned LP flow.

## Claim and source record

Repository evidence is the source of truth for Wizzy-specific behavior:

- `README.md` — one amount, an external wallet, Relay funding, user-visible positions, and six-hour curation.
- `docs/CURATION.md` — market discovery, additive admission, review policy, and cadence.
- `docs/LAUNCH_PRIVACY.md` — no implied affiliation, no personal identity, no token bundling.
- `docs/TOKEN_FLYWHEEL.md` — the app launches without a token.
- `src/portfolio/allocation.ts` — one-selected-market transaction planning.
- `src/portfolio/allocation.ts` — reviewed venue/range selection and user-owned mint recipient.
- `src/portfolio/position-actions.ts` — compound, rebalance, and ETH withdrawal preparation.

Primary external references, checked 31 August 2026:

- [Fomo homepage](https://fomo.family/) and current product voice: [product-first post](https://x.com/fomo/status/2092977947757977688), [social graph post](https://x.com/fomo/status/2092645477103669661), [trader rewards launch](https://x.com/fomo/status/2093380902751465572).
- Uniswap current voice: [TradePools launch](https://x.com/Uniswap/status/2085136053661213180), [Robinhood Chain volume post](https://x.com/Uniswap/status/2092738034768752965), [short product post](https://x.com/Uniswap/status/2091897238666490211).
- [Robinhood Chain overview](https://docs.robinhood.com/chain/), [network details](https://docs.robinhood.com/chain/connecting/), [bridging routes](https://docs.robinhood.com/chain/bridging/), and [brand guidelines](https://docs.robinhood.com/chain/brand-guidelines/). The guidelines require the full name “Robinhood Chain” and `@RobinhoodCrypto`, not `@RobinhoodApp`, for related content.
- [Uniswap liquidity overview](https://developers.uniswap.org/docs/liquidity/overview) and [v3 position ownership](https://support.uniswap.org/hc/en-us/articles/20980786685069-Why-is-liquidity-position-ownership-represented-by-tokens-or-NFTs).

## Media review verdict

**PASS**

- Blocking findings: none.
- Non-blocking findings: none. The tagline and official network lockup remain readable in the 1200×675 preview and at thumbnail scale.
- Evidence/rights: first-party Wizzy copy, mascot, palette, and type. The Robinhood Chain lockup comes unchanged from Robinhood's official asset pack and is used in the approved white-on-black pairing with clear space. No other third-party logo or implied endorsement is used.
- Unverified publishing path: no post has been published or scheduled. The final upload remains a human action from the Wizzy X account.
- Exact asset/copy awaiting approval: `launch-card-1600x900.png` plus posts 1–7 above.
