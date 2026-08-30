# Una Privy production-readiness review

- Timestamp: `2026-08-30T11:25:14+01:00` (Europe/London)
- Dashboard: `https://dashboard.privy.io/apps/cmteeqkjc03e20cjl59c9kbwu`
- Verified app name: `Una`
- Verified app ID: `cmteeqkjc03e20cjl59c9kbwu`
- Verified app state: `Development mode`
- Browser boundary: existing authenticated Chrome session only; no alternate profile or unrelated Privy app was used.
- Secrets/payment-data handling: no app secret, API credential, private key, card number, card brand, expiry, or last four digits was read, copied, typed, or recorded.

## Final state

The exact production origin remains allowed. Card onramps, bank transfer, and exchange/Coinbase funding are OFF. Ethereum, ETH, the default amount of `1 ETH`, and Solana-wallet-to-EVM cross-chain bridging remain configured. Invisible CAPTCHA is now ON with Turnstile. Crypto deposits remain OFF because Privy requires app-paid gas sponsorship and asset swaps; app-paid sponsorship was not left enabled because the page showed `$0.00 of $0 (0%)` but did not identify `$0` as a hard spend cap, and the production flow explicitly requires payment information. Gas remains `User pays`. The app remains in development mode and no purchase, subscription, billing acceptance, production promotion, fund transfer, new card, or external access request was made.

## Setting ledger

### Identity, lifecycle, and UI

| Setting | Exact BEFORE | Exact AFTER | Saved | Persistence verified |
|---|---|---|---|---|
| App identity | Name `Una`; app ID `cmteeqkjc03e20cjl59c9kbwu` | Same | No edit | Yes, repeated URL/sidebar checks |
| Application state | `Development mode` | `Development mode` | No | Yes |
| Development-mode user limit | `150 users` | `150 users` | No | Yes |
| App-secret limit | `Maximum 5 secrets per app`; `New secret` disabled | Same | No | Yes |
| Branding name | `Una` | `Una` | No | Yes |
| Branding color | `#696FFD` | `#696FFD` | No | Yes |
| Branding logo URL | Empty | Empty | No | Yes |
| Terms and conditions URL | Empty / optional | Empty / optional | No; no verified Una terms URL exists in the repository | Yes |
| Privacy policy URL | Empty / optional | Empty / optional | No; no verified Una privacy URL exists in the repository | Yes |
| Require affirmative consent | Disabled while terms/privacy URLs are empty | Disabled | No | Yes |
| App clients | No clients shown; only `Create client` | Same | No | Yes |

### Origins and baseline security

| Setting | Exact BEFORE | Exact AFTER | Saved | Persistence verified |
|---|---|---|---|---|
| Allowed origin: production | `https://unabot.vercel.app` present | Present | No edit needed | Yes, revisited Domains after all changes |
| Allowed origin: local | `http://localhost:3000` present | Present | No | Yes |
| Recommended additional origin | Dashboard suggested `https://www.unabot.vercel.app` | Not added | No; not required by the request and not independently verified as a deployed origin | Yes |
| HttpOnly cookies | OFF | OFF | No; enabling can change client/server session behavior and was not unambiguous without an integration test | Yes |
| Invisible CAPTCHA | OFF | ON | Yes; toast: `Captcha enabled successfully` | Yes, reload showed the switch ON |
| CAPTCHA provider | Hidden/inactive while CAPTCHA was OFF | `Turnstile` selected | Saved with CAPTCHA enable | Yes, reload showed Turnstile selected |
| Android key hashes | None shown | None | No; no Android app was in scope | Yes |
| Allowed OAuth redirect URLs | None shown | None | No; configured OAuth login methods are OFF and no verified redirect path was supplied | Yes |
| IP allowlist | None shown | None | No; no safe static server IP/CIDR was available | Yes |
| Account merging | ON | ON | No | Yes |

Exact allowed origins after final re-verification:

1. `http://localhost:3000`
2. `https://unabot.vercel.app`

### Funding methods and defaults

| Setting | Exact BEFORE | Exact AFTER | Saved | Persistence verified |
|---|---|---|---|---|
| Card onramps | OFF | OFF | No edit needed | Yes, reload |
| Bank transfer | OFF | OFF | No edit needed | Yes, reload |
| Exchange | ON | OFF | Yes | Yes, reload showed OFF |
| Coinbase exchange/onramp provider | `Enabled`; description: `Coinbase exchange transfers, cards, Apple Pay, and ACH.` | Disabled; no provider displayed under Exchange | Yes; confirmation stated stored API keys would be kept for reversible re-enable | Yes, reload |
| Crypto deposits | OFF | OFF | No; an enable attempt exposed blocking prerequisites and did not persist | Yes, reload showed OFF |
| Default network | `Ethereum` | `Ethereum` | No edit needed | Yes, revisited after Exchange change |
| Default token/asset | `ETH` | `ETH` | No edit needed | Yes |
| Default funding amount | `1 ETH` | `1 ETH` | No edit needed | Yes |
| Solana-to-EVM cross-chain funding | ON; exact label: `Enable cross-chain bridging, allowing users to fund wallets on EVM from a Solana wallet.` | ON | No edit needed | Yes |

Coinbase configuration was inspected only far enough to confirm the provider and reversible Disable path. The dialog displayed App ID, Key ID, and Private key fields plus the banner `App ID can’t be changed once set`; credential values were not read or recorded. The disable confirmation stated: `Your API keys are kept, so you can re-enable it at any time.`

Crypto-deposit blockers shown by Privy:

- `Complete gas sponsorship setup to enable crypto deposits` — `Add a payment method and enable gas sponsorship to use deposit addresses on mainnet.`
- `Enable asset swaps to enable crypto deposits` — `Incoming funds are routed with asset swaps.`

Because gas sponsorship failed the explicit hard-cap requirement below, crypto deposits could not be safely enabled. Asset swaps were also left OFF so an unrelated swap surface was not enabled while deposits remained blocked.

### Embedded wallet and authentication review

| Setting | Exact BEFORE | Exact AFTER | Saved | Persistence verified |
|---|---|---|---|---|
| Login: Email | ON | ON | No | Yes |
| Login: External wallets | ON | ON | No | Yes |
| Login: SMS | OFF | OFF | No | Yes |
| Login: Passkeys | OFF | OFF | No | Yes |
| Social login methods | Google, Apple, Twitter, Farcaster, GitHub, Discord, LinkedIn, TikTok, LINE, Twitch, Spotify, Instagram, Telegram all OFF | Same | No | Yes |
| Automatic embedded-wallet creation | ON | ON | No; preserves the one-action flow | Yes |
| Automatic EVM wallet creation | ON | ON | No | Yes |
| Automatic SVM/Solana wallet creation | OFF | OFF | No; no unrelated chain wallet was enabled | Yes |
| Create embedded wallets for users with linked external wallets | OFF | OFF | No | Yes |
| Transaction MFA | OFF | OFF | No; enabling changes transaction UX and required a deliberate factor/flow decision | Yes |
| MFA factors | Authenticator app OFF; Passkey OFF; SMS OFF | Same | No | Yes |
| MFA verification cache | `15 minutes` | `15 minutes` | No | Yes |
| Prioritized login type | Web2 selected; Web3 not selected | Same | No | Yes |
| Disable confirmation modals | OFF | OFF | No; default review prompts remain enabled | Yes |
| Session duration | `30 days` | `30 days` | No | Yes |
| Signing key duration | `60 minutes` | `60 minutes` | No | Yes |
| Access token duration | `1 hour` | `1 hour` | No | Yes |
| Refresh token duration | `30 days` | `30 days` | No | Yes |
| ID token duration | `10 hours` | `10 hours` | No | Yes |
| CLI and agent access | OFF | OFF | No | Yes |
| Test accounts | OFF | OFF | No | Yes |
| Guest accounts | OFF | OFF | No | Yes |
| Login-method transfer | OFF | OFF | No; this can delete the prior account after transfer | Yes |
| Return user data in identity token | OFF | OFF | No; avoids expanding browser-to-backend identity data exposure | Yes |
| Access-control allow/deny list | OFF; all users can sign up | OFF | No; no validated production allow/deny list was supplied | Yes |

Recommendations not applied:

- Transaction MFA: consider enabling with Authenticator app and/or Passkey after testing the one-action transaction flow. It was not changed because factor enrollment and reauthentication behavior can materially affect conversion and recovery.
- HttpOnly cookies: the dashboard describes this as isolating wallets from authentication tokens, but enabling it can change application session behavior. Test the current Una integration first.
- Allowed OAuth redirect URLs and IP allowlisting: configure only after exact redirect paths and stable server egress addresses are known.
- Terms/privacy URLs: add them once Una has verified, deployed documents; no such routes were found in the local repository.

### Wallet infrastructure review

| Setting | Exact BEFORE | Exact AFTER | Saved | Persistence verified |
|---|---|---|---|---|
| Wallet environment | `TEE enabled` | `TEE enabled` | No | Yes |
| Smart wallets | OFF | OFF | No; not required for the current embedded-EVM flow | Yes |
| Asset swaps | OFF | OFF | No; it is a crypto-deposit prerequisite, but enabling it alone would expose unrelated swap functionality while sponsorship remains blocked | Yes |
| Global wallet | `My app` page showed no editable controls | Same | No | Yes |
| Asset monitoring table | Default dashboard assets shown across Ethereum/Base/Arbitrum/Polygon/Solana/Tron/Tempo and other chains | Same | No; this page controls monitoring, not chain enablement | Yes |

No MFA or recovery protection was weakened. No wallet/export/private-key setting was enabled or opened. No unrelated chain wallet was enabled.

## Gas sponsorship findings

### Exact status and billing display

| Setting | Exact BEFORE | Exact AFTER | Saved | Persistence verified |
|---|---|---|---|---|
| Sponsorship mode | `User pays` | `User pays` | Final state restored; see inspection note below | Yes, reload showed User pays |
| Spend display | `$0.00` spent `of $0 (0%)` | Same | No | Yes |
| Billing cycle | `Aug 1 – Aug 31` | Same | No | Yes |
| Payment method | `Link` | `Link` | No | Yes |
| Explicit hard spend cap | None labelled or shown as a hard cap | None | No | Yes |
| Sponsored chains | None configured in final User pays state | None | No | Yes |
| Allow client-side sponsored transactions | OFF during App pays inspection | OFF / not applicable in final User pays mode | No | Yes |
| Custom gas payment assets | None shown; native network token is the default | None | No | Yes |

The dashboard displayed `Payment method: Link`; it did not show card details. The `$0` value was not labelled as a budget, hard cap, free credit, wallet balance, or auto-reload threshold. Therefore it was treated as ambiguous, not as authorization for future spend.

Inspection note: selecting `App pays` to inspect its setup immediately autosaved and displayed `Switched to app pays mode.` The setup revealed no configured chain, a disabled client-transaction switch, and the chain selector. Because there was no explicit hard finite cap, it was immediately switched back; the dashboard displayed `Switched to user pays mode.`, and a subsequent reload verified `User pays` persisted.

### Available App pays chain options inspected

Mainnet options shown:

- Tempo
- Ethereum
- Solana — disabled, `Approval required`
- Base
- Optimism
- Polygon
- Arbitrum
- BNB Smart Chain
- Unichain
- Gnosis
- Plasma
- Berachain
- Warden
- Flow
- Edge
- Monad
- Ronin
- World Chain
- Story
- Fluent
- MegaETH
- Ink
- Robinhood Chain
- Stable
- Shape
- Linea
- X Layer

Test-network options shown:

- Tempo Testnet
- Sepolia
- Solana Devnet — disabled, `Approval required`
- Base Sepolia
- Amoy
- OP Sepolia
- Arbitrum Sepolia
- MegaETH Testnet (Deprecated)
- MegaETH Testnet
- Seismic Testnet
- Ronin Saigon
- Unichain Sepolia
- Monad Testnet
- Fluent Testnet
- Ink Sepolia
- Edge Testnet
- Robinhood Testnet
- Stable Testnet
- Shape Sepolia

Solana gas sponsorship banner: `Solana gas sponsorship requires approval` and `Solana gas sponsorship is not enabled for your account.` The external approval form was not opened or submitted.

The `Manage credit` link rendered with the literal target `/apps/[app_id]/gas_sponsorship`, not the verified Una app ID. It was not followed because it would leave the exact app-ID boundary and did not expose a trustworthy cap editor from the verified page.

## Plans, quotas, and production-only banners

The app banner consistently stated: `This app is in development mode.` The Basics page stated that development mode supports only `150 users` and must be upgraded to support more than 150.

The production-promotion flow showed:

| Plan | Price shown | Included limits/features shown |
|---|---:|---|
| Free — Current | `$0 per month` | Up to `500 MAUs`; up to `50,000 signatures` |
| Core | `$299 per month` | Up to `2,500 MAUs`; up to `50,000 signatures`; WhatsApp login |
| Scale | `$499 per month` | Up to `10,000 MAUs`; up to `50,000 signatures`; Custom auth; Custom OAuth |
| Enterprise | `Talk to us` | Custom plans; dedicated support; custom integrations; Webhooks |

Paid-feature toggles shown in the promotion flow:

- `Custom authentication` — `Scale`
- `Custom OAuth` — `Scale`

Exact payment banner:

> Payment information needed. To continue with a free plan, we’ll still need to collect payment information. By continuing, you’ll be prompted to enter credit card information, and you’ll only be billed if you exceed the 500 MAU limit.

No production plan was selected and `Continue` was not clicked.

## Production-promotion and billing stops

1. Production promotion: stopped on `Confirm subscription plan and features` before `Continue`. The page required payment information even for the Free plan and described overage billing above 500 MAUs.
2. Gas sponsorship: stopped without App pays enabled because `$0.00 of $0 (0%)` was not identified as a hard spend cap or finite budget. No credit purchase, auto-reload, subscription, terms acceptance, or billing confirmation was opened.
3. Crypto deposits: remained OFF because Privy required gas sponsorship and asset swaps. No billing or production gate was crossed to satisfy those prerequisites.
4. Solana gas sponsorship: stopped at the `Approval required` banner; no external access request was made.
5. Production-only capacity/features: supporting more than 150 development users requires production promotion; WhatsApp login was shown under Core, Custom auth/OAuth under Scale, and Webhooks under Enterprise. None were enabled.

## Changes actually saved

1. Coinbase exchange/onramp provider: `Enabled` -> disabled, causing Exchange funding `ON` -> `OFF`. Persistence verified after reload.
2. Invisible CAPTCHA: `OFF` -> `ON`, provider `Turnstile`. Persistence verified after reload.
3. Gas sponsorship inspection state: temporary `User pays` -> `App pays` autosave was immediately restored to `User pays`; persistence verified after reload. This produced no final net change and no chain or client sponsorship was configured.

No other setting was changed.
