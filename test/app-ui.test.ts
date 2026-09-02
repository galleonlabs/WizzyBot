import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/page.tsx", "utf8");
const appPage = readFileSync("app/app/page.tsx", "utf8");
const portfolio = readFileSync("app/portfolio-app.tsx", "utf8");
const poolTable = readFileSync("app/pools/pool-table.tsx", "utf8");
const lpSheet = readFileSync("app/pools/lp-sheet.tsx", "utf8");
const positionCard = readFileSync("app/positions/position-card.tsx", "utf8");
const actionSheet = readFileSync("app/positions/action-sheet.tsx", "utf8");
const rangeChart = readFileSync("app/positions/range-chart.tsx", "utf8");
const sendEthDialog = readFileSync("app/send-eth-dialog.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");
const providers = readFileSync("app/providers.tsx", "utf8");
const wagmiConfig = readFileSync("app/lib/wagmi.ts", "utf8");
const links = readFileSync("app/lib/links.ts", "utf8");
const mascot = readFileSync("public/brand/wizzy-mascot.svg", "utf8");
const ghostLight = readFileSync("public/brand/wizzy-ghost-light.svg", "utf8");
const ghostDark = readFileSync("public/brand/wizzy-ghost-dark.svg", "utf8");
const socialCard = readFileSync("public/brand/wizzy-social-unbounded-v1.png");
const nextConfig = readFileSync("next.config.ts", "utf8");
const poolsRoute = readFileSync("app/api/pools/route.ts", "utf8");
const cronRoute = readFileSync("app/api/cron/pools/route.ts", "utf8");
const snapshotStore = readFileSync("app/lib/pool-snapshot-server.ts", "utf8");
const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons?: Array<{ path: string; schedule: string }> };
const relayQuoteRoute = readFileSync("app/api/relay/quote/route.ts", "utf8");
const poolActivityRoute = readFileSync("app/api/pool-activity/route.ts", "utf8");
const apiBoundary = readFileSync("app/lib/api-request-server.ts", "utf8");
const balanceRoute = readFileSync("app/api/balance/route.ts", "utf8");
const positionActionRoute = readFileSync("app/api/portfolio/action/route.ts", "utf8");
const hostedBundle = readFileSync("src/hosted-bundle.ts", "utf8");
const hostedSurface = readFileSync("src/surfaces/hosted.ts", "utf8");
const portfolioTypes = readFileSync("app/lib/portfolio-types.ts", "utf8");
const positionActions = readFileSync("src/portfolio/position-actions.ts", "utf8");
const discovery = readFileSync("src/markets/discovery.ts", "utf8");
const relayClient = readFileSync("src/relay/client.ts", "utf8");
const relayFees = readFileSync("src/relay/fees.ts", "utf8");
const achievementCenter = readFileSync("app/achievement-center.tsx", "utf8");
const achievementsRoute = readFileSync("app/api/achievements/route.ts", "utf8");
const shotFixture = readFileSync("app/lib/shot-fixture.ts", "utf8");

describe("meme yield curator surface", () => {
  it("serves the app at the root and retires the coming-soon gate", () => {
    expect(page).toContain("<PortfolioApp />");
    expect(page).not.toContain("coming-soon");
    expect(appPage).toContain('redirect("/")');
    expect(existsSync("app/admin/page.tsx")).toBe(false);
    expect(existsSync("app/markets/market-ledger.tsx")).toBe(false);
    expect(layout).toContain('const socialTitle = "Wizzy: Meme Yield, Curated"');
    expect(layout).toContain("Curated meme LP pools on Base and Robinhood Chain");
  });

  it("opens on curated pools with Relay as the only way in", () => {
    expect(portfolio).toContain('useState<ViewTab>("pools")');
    expect(portfolio).toContain('{ id: "pools", label: "Pools" }, { id: "positions", label: "Positions" }');
    expect(portfolio).toContain("<h1>Meme yield, curated.</h1>");
    expect(portfolio).toContain("<PoolTable pools={pools.pools}");
    expect(portfolio).toContain('setLpTarget({ kind: "new", pool })');
    expect(portfolio).toContain("Wizzy adds a 0.3% fee inside each Relay quote");
    expect(portfolio).not.toMatch(/planAllocation|allocate|ZapPanel|MarketLedger|rebalance/);
    expect(poolTable).toContain("LP this pool");
    expect(poolTable).toContain('<th>Pool</th><th>Fee APR · 24h</th><th>Volume · 24h</th><th>Liquidity</th><th>Age</th><th>Checks</th><th>Action</th>');
    expect(poolTable).toContain('reviewed: { label: "Reviewed", tone: "good"');
    expect(poolTable).toContain('unverified: { label: "Unverified", tone: "warn"');
    expect(poolTable).toContain("Reviewed only");
    expect(poolTable).toContain('<option value="apr">Fee APR</option>');
  });

  it("monetises every Relay quote through the treasury and hands off to the venue", () => {
    expect(relayFees).toContain("export const WIZZY_APP_FEE_BPS = 30");
    expect(relayFees).toContain("return loadEnv().treasury");
    expect(relayClient).toContain('appFees: [{ recipient: appFeeRecipient(), fee: String(feeBps) }]');
    expect(relayClient).toContain('referrer: "wizzy.meme"');
    expect(relayClient).toContain("Relay sender does not match wallet");
    expect(relayQuoteRoute).toContain("quoteRelaySwap({ ...body, amountWei: BigInt(body.amountWei) })");
    expect(lpSheet).toContain('fetch("/api/relay/quote"');
    expect(lpSheet).toContain("Move ETH from ${originLabel} to ${destination.chainLabel}");
    expect(lpSheet).toContain("Swap ETH for ${meme.symbol} on ${destination.chainLabel}");
    expect(lpSheet).toContain("await waitForRelay(current.quote.statusPath)");
    expect(lpSheet).toContain("createPositionUrl({ venue: target.pool.venue");
    expect(lpSheet).toContain("Set your range and confirm there. Wizzy never holds your funds.");
    expect(lpSheet).toContain('kind: "sell"');
    expect(links).toContain("positions/create/${version}?${params.toString()}");
    expect(links).toContain("aerodrome.finance");
    expect(hostedBundle).toContain('quoteRelaySwap, relayIntentStatus } from "./relay/client.js"');
    expect(hostedBundle).toContain('fetchCuratedPools, mergeSnapshots } from "./markets/discovery.js"');
    expect(hostedBundle).not.toMatch(/allocation\.js|venue-observations/);
    expect(existsSync("src/portfolio/allocation.ts")).toBe(false);
    expect(existsSync("app/api/portfolio/allocate/route.ts")).toBe(false);
  });

  it("discovers broadly and curates deterministically", () => {
    expect(discovery).toContain("export function curatePools");
    expect(discovery).toContain("minLiquidityUsd: 10_000");
    expect(discovery).toContain("api.gopluslabs.io");
    expect(discovery).toContain("api.geckoterminal.com");
    expect(discovery).toContain('{ chain: "robinhood", path: "trending_pools?page=1" }');
    expect(discovery).toContain('{ chain: "base", path: "new_pools?page=1" }');
    expect(discovery).toContain("Reviewed markets always make the menu");
    expect(poolsRoute).toContain("Read path only. The cron at /api/cron/pools is the single writer");
    expect(poolsRoute).toContain("s-maxage=60, stale-while-revalidate=300");
    expect(poolsRoute).not.toMatch(/warming|after\(/);
    expect(cronRoute).toContain('request.headers.get("authorization") !== `Bearer ${secret}`');
    expect(cronRoute).toContain("mergePoolSnapshots(previous ?? undefined, next)");
    expect(cronRoute).toContain("writeSnapshot(merged");
    expect(snapshotStore).toContain('export const SNAPSHOT_PATHNAME = "pools/latest.json"');
    expect(snapshotStore).toContain("allowOverwrite: true");
    expect(vercelConfig.crons).toEqual([{ path: "/api/cron/pools", schedule: "*/5 * * * *" }]);
    expect(portfolio).toContain('fetch("/api/pools", { cache: "default" })');
    expect(portfolio).toContain('document.addEventListener("visibilitychange", onVisible)');
    expect(portfolio).not.toMatch(/warming|setTimeout\(\(\) => void loadPools/);
    expect(discovery).toContain("export function mergeSnapshots");
  });

  it("keeps positions read-first with only single-transaction actions in-app", () => {
    expect(positionActionRoute).toContain('action: z.enum(["collect", "decrease", "withdraw"])');
    expect(positionActionRoute).not.toMatch(/rebalance|increase|compound|settle/);
    expect(positionActions).toContain("export function atomicActionsFor");
    expect(positionActions).toContain("atomic: true");
    expect(positionActions).not.toMatch(/quoteRebalanceSwap|buildIncreaseFromEthPlan|planRangeSwap|exactInV3Tx/);
    expect(positionCard).toContain('const singleTx = open && (view.protocol === "V4" || (view.protocol === "V3" && view.venue !== "aerodrome-slipstream"))');
    expect(positionCard).toContain('className="lp-manage"');
    expect(positionCard).toContain("This takes more than one transaction, so it happens on ${venue}");
    expect(positionCard).toContain("<dt>Position value</dt>");
    expect(positionCard).toContain("<dt>Unclaimed fees</dt>");
    expect(positionCard).toContain("<RangeChart view={view} ethUsd={ethUsd} />");
    expect(actionSheet).toContain('collect: "Collect fees"');
    expect(actionSheet).toContain('decrease: "Reduce position"');
    expect(actionSheet).toContain('withdraw: "Exit position"');
    expect(actionSheet).toContain("Sell {memeToken.symbol} for ETH");
    expect(actionSheet).toContain("<dt>Wallet steps</dt><dd>1 transaction</dd>");
    expect(portfolio).toContain('setLpTarget({ kind: "sell", position, token, image })');
    expect(portfolio).toContain('setLpTarget({ kind: "add", position, meme:');
    expect(rangeChart).toContain("const flip = quoteIsToken0 === true");
    expect(hostedSurface).toContain("address0: snap.token0.address");
    expect(portfolioTypes).toContain('export type PositionActionKind = "collect" | "decrease" | "withdraw"');
  });

  it("loads each chain independently so one slow RPC never hides the other", () => {
    expect(portfolio).toContain("await loadPositionRows(address, fetch, 25_000, ({ chain, rows, ethUsd }) =>");
    expect(portfolio).toContain("setPositions((current) => [...current.filter((position) => position.chain !== chain), ...next])");
    expect(portfolio).toContain('className="lp-card is-skeleton"');
  });

  it("lets wallets pay from five networks and keeps the CSP in step", () => {
    expect(wagmiConfig).toContain("chains: [base, robinhoodChain, mainnet, arbitrum, optimism]");
    expect(wagmiConfig).toContain('http("https://eth.merkle.io")');
    expect(nextConfig).toContain("https://eth.merkle.io https://arb1.arbitrum.io https://mainnet.optimism.io https://api.relay.link");
    expect(nextConfig).toContain("object-src 'none'");
    expect(nextConfig).toContain("frame-ancestors 'none'");
    expect(nextConfig).not.toContain("connect-src *");
    expect(portfolioTypes).toContain("{ id: 4663, label: \"Robinhood Chain\", slug: \"robinhood\" }");
    expect(lpSheet).toContain("RELAY_CHAINS.map((chain) => <option");
    expect(lpSheet).toContain("fetch(`/api/balance?${params.toString()}`");
    expect(lpSheet).not.toMatch(/wagmi\/actions/);
    expect(balanceRoute).toContain("if (chainId === 1) return { chain: mainnet");
    expect(balanceRoute).toContain('functionName: "balanceOf"');
  });

  it("uses deliberate mobile layouts instead of shrinking desktop rows", () => {
    expect(css).toContain(".market-table tr { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr))");
    expect(css).toContain(".pool-table td:nth-child(7) { grid-column: 1 / -1; }");
    expect(css).toContain(".lp-body { grid-template-columns: minmax(0, 1fr); gap: 18px; }");
    expect(css).toContain(".sheet { width: 100%; max-height: calc(100dvh - 16px);");
    expect(css).toContain(".portfolio-empty .empty-symbol { display: none; }");
    expect(css).toContain(".market-link-label { display: none; }");
    expect(css).toContain("@media (max-width: 360px)");
    expect(css).toContain(".wizzy-wordmark > span { position: absolute");
    expect(css).toContain(".social-button { display: none; }");
    expect(css).not.toContain(".zap-dialog");
  });

  it("pairs a characterful display face with a restrained trading UI", () => {
    expect(layout).toContain("Unbounded");
    expect(layout).toContain("Plus_Jakarta_Sans");
    expect(layout).toContain("@vercel/analytics/next");
    expect(layout).toContain("@vercel/speed-insights/next");
    expect(css).toContain("font-family: var(--font-display)");
    expect(css).toContain("--coral: #ff6f83");
    expect(css).toContain("--canvas: #09090d");
    expect(css).toContain("--surface: #111116");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(':root[data-theme="dark"]');
    expect(layout).toContain('localStorage.getItem("wizzy-theme")');
    expect(portfolio).toContain('useState<ThemePreference>("dark")');
    expect(css).not.toMatch(/#FC72FF|#FF37C7|#ff007a/i);
    expect(css).not.toMatch(/gradient/i);
  });

  it("reduces Wizzy to one oversized hooded head and carries the ghost pattern", () => {
    expect(mascot).toContain("single oversized hooded head");
    expect(mascot.match(/<path /g)).toHaveLength(2);
    expect(mascot).toContain('fill="#77e8c9"');
    expect(portfolio).toContain('className="wizzy-atmosphere" aria-hidden="true"');
    expect(portfolio.match(/className="wizzy-ghost wizzy-ghost-/g)).toHaveLength(6);
    expect(css).toContain("@keyframes wizzy-drift");
    expect(ghostLight).toContain('fill="#202029"');
    expect(ghostDark).toContain('fill="#f7f3ed"');
  });

  it("ships the Wizzy identity, social card, and X account", () => {
    expect(layout).toContain('const siteUrl = "https://wizzy.meme"');
    expect(layout).toContain('siteName: "Wizzy"');
    expect(layout).toContain('card: "summary_large_image"');
    expect(layout).toContain('url: "/brand/wizzy-social-unbounded-v1.png"');
    expect(socialCard.readUInt32BE(16)).toBe(1200);
    expect(socialCard.readUInt32BE(20)).toBe(630);
    expect(portfolio).toContain('aria-label="Wizzy pools"');
    expect(portfolio).toContain('href="https://x.com/wizzydotmeme"');
    expect(layout).toContain('site: "@wizzydotmeme"');
  });

  it("connects external wallets only, with no embedded or sponsored path", () => {
    expect(providers).toContain("WagmiProvider");
    expect(wagmiConfig).toContain("injected()");
    expect(wagmiConfig).toContain("robinhood-rpc.publicnode.com");
    expect(portfolio).toContain("Connect a wallet");
    expect(portfolio).toContain("Your wallet holds every position. Wizzy never takes custody.");
    expect(portfolio).not.toMatch(/privy|sponsor/i);
    expect(portfolio).toContain('aria-haspopup="menu"');
    expect(portfolio).toContain("robinhoodchain.blockscout.com/address/");
    expect(sendEthDialog).toContain("Paid by your wallet");
    expect(shotFixture).not.toContain('chain: "solana"');
  });

  it("keeps custom RPC credentials on the server and the API boundary strict", () => {
    expect(poolActivityRoute).toContain("unstable_cache");
    expect(apiBoundary).toContain("same-origin request required");
    expect(apiBoundary).toContain("redactServerError");
    expect(balanceRoute).toContain("client.getBalance");
    expect(balanceRoute).toContain("process.env.ROBINHOOD_RPC_URL");
    expect(existsSync("app/api/markets/route.ts")).toBe(false);
    expect(existsSync("app/lib/solana-zap-server.ts")).toBe(false);
  });

  it("keeps wallet-scoped quests wired to the header", () => {
    expect(portfolio).toContain("<AchievementCenter");
    expect(achievementCenter).toContain('id="quest-board-title">Quests</h2>');
    expect(achievementsRoute).toContain("verifyOnchainQuestAction");
    expect(css).toContain(".achievement-backdrop {\n  position: fixed;");
  });
});
