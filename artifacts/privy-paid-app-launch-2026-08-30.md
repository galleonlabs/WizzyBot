# Una paid Privy app launch record

## Final app boundary

- App name: `Una`
- App ID: `cmtft1kti01cf0dl73c3zpuem`
- State: production
- Workspace: the paid Core workspace selected by the operator
- Environment policy: this one app ID and secret are used by Vercel Production, Preview, Development, and the local workspace. The retired development app is no longer referenced by Una configuration.

Allowed origins are intentionally exact:

- `https://unabot.vercel.app`
- `https://unabot-git-main-adwilkinsons-projects.vercel.app`
- `http://localhost:3000`

Una does not allow `https://*.vercel.app`. Privy rejects generic hosting-provider wildcards because unrelated accounts can deploy beneath them. Feature previews that need authentication should use an explicitly added stable origin or a client within this same Privy app.

## Authentication and wallets

- Email login: enabled.
- External wallet login: enabled.
- Embedded EVM wallet creation: automatic for all users.
- Embedded Solana wallet creation: automatic for all users.
- Invisible CAPTCHA: enabled.
- Production login modal: opened successfully from `https://unabot.vercel.app/app` after the Vercel migration.

The app supports both Privy embedded wallets and external wallets. Gas sponsorship applies only where Privy can sponsor the actual wallet transaction; it is not described as universal sponsorship for every external-wallet path.

## Funding

- Crypto deposits: enabled.
- Default asset: ETH.
- Default network: Ethereum.
- Default funding amount: `1 ETH`.
- Solana-to-EVM cross-chain bridging: enabled.
- Card onramp, bank transfer, and exchange funding: not enabled as additional product surfaces.

Una retains Relay for Robinhood Chain delivery. Privy's deposit-address routing does not replace the destination-chain ownership, gas-reserve, and transaction-sender constraints already enforced by Una.

## Gas sponsorship

- Sponsorship mode: `App pays`.
- Sponsored production chains: Ethereum and Base.
- Client-side sponsored transactions: enabled.
- Dashboard budget boundary: the existing monthly credit is finite; the dashboard showed a total monthly allowance of `$24.99` when sponsorship was enabled.
- No credit purchase, payment-method change, transfer, or live blockchain transaction was made during configuration.

Privy warns that client-side sponsorship is heavily rate-limited. Una therefore treats sponsorship as onboarding help, not an availability promise. Robinhood Chain is not claimed as sponsored: Relay-funded allocations retain an explicit native-gas reserve on the destination.

## Deployment and secret handling

- `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_ID`, and `PRIVY_APP_SECRET` point to the paid app in Production, Preview, and Development.
- The local ignored environment file points to the same app.
- The public app ID was verified in the deployed JavaScript bundle.
- The production login modal rendered successfully from the canonical domain.
- The one-time generated Privy secret files were deleted after Vercel and local migration verification.
- No secret value entered source, Git history, build output, screenshots, or this record.

## Remaining transaction QA

The logged-out production login modal and paid-app bundle are verified. A logged-in deposit plan may be reviewed up to the signature boundary, but no transaction should be signed or funded as part of configuration QA.

## Official references

- Allowed origins: https://docs.privy.io/recipes/react/allowed-domains
- Funding overview: https://docs.privy.io/wallets/funding/overview
- Add funds: https://docs.privy.io/wallets/funding/add-funds
- Gas overview: https://docs.privy.io/wallets/gas-and-asset-management/gas/overview
