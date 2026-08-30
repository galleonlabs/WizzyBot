# Wizzy launch privacy

## Security objective

Wizzy can operate under a public pseudonym. It cannot honestly promise total anonymity.

GitHub, Vercel, Privy, Pools, X, infrastructure providers, payment providers, legal advisers, and public blockchains may retain or expose operator information. Blockchain funding and wallet activity are public and may be linkable. The policy is to prevent unnecessary public attribution while keeping lawful records and accurate disclosures—not to conceal ownership from providers, regulators, counterparties, or users who are entitled to know it.

## Current public boundary

- The source repository remains private.
- The public product, metadata, assets, links, treasury labels, and API responses must contain no personal or Galleon identity.
- The dedicated Wizzy treasury and token-creator address must not be reused for unrelated activity.
- Private keys never enter source, browser code, screenshots, logs, analytics, support messages, or social drafts.
- Product claims use Wizzy as the product identity and disclose related-party token control when that fact becomes relevant.

This boundary is enforced by a repository test over shipped source and public assets. It is also rechecked against the deployed HTML, JavaScript, metadata, headers, images, and API responses before a public launch.

## Repository and deployment controls

1. Keep the repository private. Existing private Git history contains operator authorship and must not be published as-is.
2. If open-sourcing becomes a goal, create a separately reviewed public history or explicitly approve a one-time history rewrite before publication. Do not rewrite the working repository casually.
3. Keep Vercel project ownership, Git remote URLs, source maps, analytics payloads, error reports, and generated metadata out of public pages.
4. Use generic support and security contact identities created for Wizzy before those addresses are exposed.
5. Run secret, identity-string, source-map, junk-file, and response-header scans on the exact production commit.

## Wallet and custody controls

The creator/treasury EOA is a dedicated wallet whose private key is stored as a retrievable, encrypted, production-only Vercel secret. The application and dappnode curator do not read it. Centralized index curation changes the version-controlled catalog and does not require the wallet or an onchain signature. There is deliberately no multisig.

Before the wallet controls material value, re-verify the Vercel recovery path, project-administrator list, dappnode file permissions, and public address. The key must never be placed in client variables, source, shell history, logs, screenshots, analytics, or social tooling.

Assume every funding transaction is publicly attributable through chain analysis. Use a documented lawful funding path and accurate accounting. Do not use mixers, circular transfers, false counterparties, or obfuscation to manufacture anonymity.

## Pools and X separation

- Use dedicated Wizzy credentials and recovery channels, stored in the password manager and protected with passkeys or hardware keys.
- Do not reuse personal usernames, biographies, profile images, recovery email addresses, phone numbers, browser autofill, or public wallet labels.
- Before submitting to Pools, verify the selected account, chain, creator address, recipients, and transaction simulation.
- Before posting on X, verify the final onchain contract address from independent chain data and use the same canonical address everywhere.
- Do not claim affiliation with Robinhood, Uniswap, Fomo, Pools, or any constituent token.
- Do not imply that pseudonymity removes related-party conflicts. Publish treasury, creator, allocations, vesting, and index-sleeve control.

## Operational launch checklist

- [ ] Private repository and production deployment contain no personal or Galleon public strings.
- [ ] No public source map, error payload, analytics event, or response header exposes an operator or account slug.
- [ ] Creator and treasury addresses are dedicated and independently verified.
- [ ] No secret is present in Git history, build output, Vercel client variables, logs, or browser storage.
- [ ] Pools and X identities use dedicated credentials and hardened recovery.
- [ ] Connected-wallet account, chain, recipients, permissions, and full transaction simulation are reviewed before signing.
- [ ] Token contract, allocation, vesting, treasury, related-party sleeve, and risk disclosures are public.
- [ ] Public language says pseudonymous, not anonymous.
- [ ] Legal, tax, sanctions, KYC, and record-keeping requirements are handled where applicable.

## Incident response

If public attribution occurs, do not delete evidence, rotate identities impulsively, or make misleading denials. Preserve logs, secure accounts and keys, assess whether funds or users are at risk, correct inaccurate public claims, and rotate compromised credentials or authority through documented transactions.
