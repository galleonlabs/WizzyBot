import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/page.tsx", "utf8");
const adminPage = readFileSync("app/admin/page.tsx", "utf8");
const portfolio = readFileSync("app/portfolio-app.tsx", "utf8");
const positionCard = readFileSync("app/positions/position-card.tsx", "utf8");
const actionSheet = readFileSync("app/positions/action-sheet.tsx", "utf8");
const rangeChart = readFileSync("app/positions/range-chart.tsx", "utf8");
const marketLedger = readFileSync("app/markets/market-ledger.tsx", "utf8");
const sendEthDialog = readFileSync("app/send-eth-dialog.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");
const providers = readFileSync("app/providers.tsx", "utf8");
const wagmiConfig = readFileSync("app/lib/wagmi.ts", "utf8");
const mascot = readFileSync("public/brand/wizzy-mascot.svg", "utf8");
const ghostLight = readFileSync("public/brand/wizzy-ghost-light.svg", "utf8");
const ghostDark = readFileSync("public/brand/wizzy-ghost-dark.svg", "utf8");
const socialSource = readFileSync("public/brand/wizzy-social.svg", "utf8");
const socialRenderer = readFileSync("scripts/render-social-card.mjs", "utf8");
const socialCard = readFileSync("public/brand/wizzy-social-unbounded-v1.png");
const xProfile = readFileSync("public/brand/x/wizzy-x-profile-400.png");
const xBanner = readFileSync("public/brand/x/wizzy-x-banner-1500x500.png");
const xBannerSource = readFileSync("public/brand/x/wizzy-x-banner.svg", "utf8");
const nextConfig = readFileSync("next.config.ts", "utf8");
const marketsRoute = readFileSync("app/api/markets/route.ts", "utf8");
const poolActivityRoute = readFileSync("app/api/pool-activity/route.ts", "utf8");
const poolActivitySource = readFileSync("src/markets/activity.ts", "utf8");
const apiBoundary = readFileSync("app/lib/api-request-server.ts", "utf8");
const balanceRoute = readFileSync("app/api/balance/route.ts", "utf8");
const positionActionRoute = readFileSync("app/api/portfolio/action/route.ts", "utf8");
const allocationRoute = readFileSync("app/api/portfolio/allocate/route.ts", "utf8");
const portfolioRoute = readFileSync("app/api/portfolio/route.ts", "utf8");
const hostedBundle = readFileSync("src/hosted-bundle.ts", "utf8");
const hostedSurface = readFileSync("src/surfaces/hosted.ts", "utf8");
const portfolioTypes = readFileSync("app/lib/portfolio-types.ts", "utf8");
const allocationSource = readFileSync("src/portfolio/allocation.ts", "utf8");
const positionActions = readFileSync("src/portfolio/position-actions.ts", "utf8");
const achievementCenter = readFileSync("app/achievement-center.tsx", "utf8");
const achievementsRoute = readFileSync("app/api/achievements/route.ts", "utf8");
const telemetry = readFileSync("app/lib/telemetry.ts", "utf8");
const shotFixture = readFileSync("app/lib/shot-fixture.ts", "utf8");

describe("LP manager 2.0 surface", () => {
  it("exposes the full app at a passwordless, non-indexed admin route", () => {
    expect(adminPage).toContain("<PortfolioApp />");
    expect(adminPage).toContain("index: false");
    expect(adminPage).not.toMatch(/password|authenticate|redirect/i);
    expect(page).toContain("coming-soon");
    expect(page).not.toContain("PortfolioApp");
  });

  it("opens on the wallet's positions and keeps markets one tab away", () => {
    expect(portfolio).toContain('useState<ViewTab>("positions")');
    expect(portfolio).toContain('{ id: "positions", label: "Positions" }, { id: "markets", label: "Markets" }');
    expect(portfolio).toContain('if (params.get("view") === "markets") setTab("markets")');
    expect(portfolio).toContain("<PositionsPage");
    expect(portfolio).toContain('className="portfolio-summary"');
    expect(portfolio).toContain("<dt>Total value</dt>");
    expect(portfolio).toContain("<dt>Unclaimed fees</dt>");
    expect(portfolio).toContain("<dt>In range</dt>");
    expect(portfolio).toContain(">New position</button>");
    expect(portfolio).not.toContain("Make Meme Markets");
    expect(portfolio).not.toContain("PoolActivityStrip");
    expect(portfolio).not.toContain("position-manager");
  });

  it("renders every position as one card with the five management actions", () => {
    expect(positionCard).toContain('{ kind: "collect", label: "Collect"');
    expect(positionCard).toContain('{ kind: "increase", label: "Add"');
    expect(positionCard).toContain('{ kind: "decrease", label: "Reduce"');
    expect(positionCard).toContain('{ kind: "rebalance", label: "Reposition"');
    expect(positionCard).toContain('{ kind: "withdraw", label: "Exit"');
    expect(positionCard).toContain("<dt>Position value</dt>");
    expect(positionCard).toContain("<dt>Unclaimed fees</dt>");
    expect(positionCard).toContain("<dt>Pool fee APR</dt>");
    expect(positionCard).toContain("<RangeChart view={view} ethUsd={ethUsd} />");
    expect(positionCard).toContain('rebalance: open && concentrated && !view.fullRange');
    expect(positionCard).toContain('decrease: open && view.protocol !== "V2"');
    expect(css).toContain(".lp-actions { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr))");
  });

  it("draws one honest price axis where the meme price always rises to the right", () => {
    expect(rangeChart).toContain("const flip = quoteIsToken0 === true");
    expect(rangeChart).toContain("(flip ? 1 - raw : raw) * 100");
    expect(rangeChart).toContain('preserveAspectRatio="none"');
    expect(rangeChart).toContain('className="range-chart-bin"');
    expect(rangeChart).toContain('className="range-chart-band is-next"');
    expect(rangeChart).toContain("liquidityProfile?.bins");
  });

  it("runs each action through one focused sheet with quote, review, confirm, and done states", () => {
    expect(actionSheet).toContain('collect: "Collect fees"');
    expect(actionSheet).toContain('increase: "Add liquidity"');
    expect(actionSheet).toContain('decrease: "Reduce position"');
    expect(actionSheet).toContain('rebalance: "Reposition range"');
    expect(actionSheet).toContain('withdraw: "Exit position"');
    expect(actionSheet).toContain('if (action === "collect") planRef.current({ action: "collect" })');
    expect(actionSheet).toContain('planRef.current({ action: "withdraw", settle })');
    expect(actionSheet).toContain('["recenter", "Recentre"], ["10", "±10%"], ["25", "±25%"], ["50", "±50%"], ["custom", "Custom"]');
    expect(actionSheet).toContain("rangeFromMemePrices(position, min, max)");
    expect(actionSheet).toContain('type="range" min={1} max={99}');
    expect(actionSheet).toContain(">Receive ETH</button>");
    expect(actionSheet).toContain(">Receive both tokens</button>");
    expect(actionSheet).toContain("<dt>Wallet steps</dt>");
    expect(actionSheet).toContain("<dt>Wizzy fee</dt><dd>None</dd>");
    expect(actionSheet).toContain('role="dialog" aria-modal="true" aria-labelledby="sheet-title"');
    expect(actionSheet).toContain('if (event.key === "Escape" && !executing) closeRef.current()');
    expect(actionSheet).toContain('className="sheet-done"');
    expect(portfolio).toContain("const freshPlan = await requestPositionActionPlan(target.position, request)");
    expect(portfolio).toContain("transactions: freshPlan.transactions");
    expect(portfolio).toContain("sameAddress(actionPlan.owner, address)");
    expect(portfolio).toContain('cache: "no-store"');
  });

  it("manages any owned V3, Slipstream, or V4 position without the curated catalog", () => {
    expect(positionActionRoute).toContain('"collect", "compound", "increase", "decrease", "rebalance", "withdraw"');
    expect(positionActionRoute).toContain("percent: z.number().int().min(1).max(99).optional()");
    expect(positionActionRoute).toContain("tickLower: z.number().int().optional()");
    expect(positionActionRoute).toContain('settle: z.enum(["eth", "tokens"]).optional()');
    expect(positionActions).not.toContain("position pool is not in Wizzy's curated market catalog");
    expect(positionActions).toContain("export function poolContext");
    expect(positionActions).toContain("export function buildDecreasePositionActionPlan");
    expect(positionActions).toContain("export function buildEthSettlement");
    expect(positionActions).toContain("export function buildIncreaseFromEthPlan");
    expect(positionActions).toContain("export function planRangeSwap");
    expect(portfolioTypes).toContain('export type PositionActionKind = "collect" | "compound" | "increase" | "decrease" | "rebalance" | "withdraw"');
    expect(portfolioTypes).toContain("removal?: { percent: number; amount0: string; amount1: string; burn: boolean }");
    expect(hostedSurface).toContain("ethUsd: ethUsd > 0 ? ethUsd : undefined");
    expect(hostedSurface).toContain("marketId: catalogMarkets.find((market) => positionPoolIsConfigured(snap, [market]))?.id");
  });

  it("loads each chain independently so one slow RPC never hides the other", () => {
    expect(portfolio).toContain("await loadPositionRows(address, fetch, 25_000, ({ chain, rows, ethUsd }) =>");
    expect(portfolio).toContain("setPositions((current) => [...current.filter((position) => position.chain !== chain), ...next])");
    expect(portfolio).toContain('className="lp-card is-skeleton"');
    expect(portfolio).toContain("Could not read ${failed.map((chain) => chain === \"base\" ? \"Base\" : \"Robinhood\").join(\" or \")}");
  });

  it("keeps the markets flow for opening new positions", () => {
    expect(marketLedger).toContain("Add liquidity to ${market.symbol}/WETH");
    expect(marketLedger).toContain("<th>24h fee APR</th>");
    expect(marketLedger).toContain('const FOMO_REFERRER = "makemememarkets"');
    expect(marketLedger).toContain("https://fomo.family/tokens/${chain}/${token.toLowerCase()}?r=${FOMO_REFERRER}");
    expect(marketLedger).toContain("Trade ${market.symbol}/WETH on Fomo");
    expect(marketLedger).toContain('aria-label="Search markets"');
    expect(marketLedger).toContain("MARKETS_PER_PAGE");
    expect(marketLedger).toContain("Best pool selected automatically");
    expect(marketLedger).toContain("<dt>Wizzy fee</dt>");
    expect(marketLedger).not.toMatch(/app\.uniswap\.org|GeckoTerminal/i);
    expect(portfolio).toContain("Built on Base and Robinhood Chain");
    expect(portfolio).toContain("Base + Robinhood");
    expect(allocationRoute).toContain("selectBestMarketVenue(body.chain, body.marketId)");
    expect(allocationSource).toContain("const markets = activeMarkets(input.chain, [input.marketId])");
    expect(hostedBundle).toContain('selectBestMarketVenue } from "./markets/venue-observations.js"');
    expect(css).toContain(".market-pagination");
  });

  it("uses deliberate mobile layouts instead of shrinking desktop rows", () => {
    expect(css).toContain(".market-table tr { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr))");
    expect(css).toContain(".lp-body { grid-template-columns: minmax(0, 1fr); gap: 18px; }");
    expect(css).toContain(".lp-actions button { flex-direction: column; gap: 5px; min-height: 56px;");
    expect(css).toContain(".sheet { width: 100%; max-height: calc(100dvh - 16px);");
    expect(css).toContain(".portfolio-empty .empty-symbol { display: none; }");
    expect(css).toContain(".market-link-label { display: none; }");
    expect(css).toContain("@media (max-width: 360px)");
    expect(css).toContain(".wizzy-wordmark > span { position: absolute");
    expect(css).toContain(".social-button { display: none; }");
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
    expect(layout).toContain('saved==="system"||saved==="light"||saved==="dark"?saved:"dark"');
    expect(portfolio).toContain('useState<ThemePreference>("dark")');
    expect(portfolio).toContain('window.localStorage.setItem("wizzy-theme", next)');
    expect(css).not.toMatch(/#FC72FF|#FF37C7|#ff007a/i);
    expect(css).not.toMatch(/gradient/i);
  });

  it("reduces Wizzy to one oversized hooded head", () => {
    expect(mascot).toContain("single oversized hooded head");
    expect(mascot).toContain("M33 98C47 76 68 64 86 48");
    expect(mascot).toContain("M48 104C61 80 91 68 127 68");
    expect(mascot.match(/<path /g)).toHaveLength(2);
    expect(mascot).toContain('fill="#77e8c9"');
    expect(mascot).not.toMatch(/staff|crystal|hands|feet|stroke=/i);
    expect(mascot).toContain('rx="22" ry="32"');
    expect(mascot).toContain('rx="7" ry="10"');
    expect(mascot).toContain("pronounced point and enormous mint eyes");
    expect(mascot).toContain("94 10C124 14 154 28 180 52");
  });

  it("carries the ghostly Wizzy pattern into both themes without competing with the product", () => {
    expect(portfolio).toContain('className="wizzy-atmosphere" aria-hidden="true"');
    expect(portfolio.match(/className="wizzy-ghost wizzy-ghost-/g)).toHaveLength(6);
    expect(css).toContain('--wizzy-ghost-image: url("/brand/wizzy-ghost-light.svg")');
    expect(css).toContain('--wizzy-ghost-image: url("/brand/wizzy-ghost-dark.svg")');
    expect(css).toContain("@keyframes wizzy-drift");
    expect(css).toContain(".wizzy-ghost-2,\n  .wizzy-ghost-4 { display: none; }");
    expect(css).toContain(".wizzy-ghost { animation: none; transform: rotate(var(--ghost-rotation)); will-change: auto; }");
    expect(ghostLight).toContain('fill="#202029"');
    expect(ghostDark).toContain('fill="#f7f3ed"');
    expect(ghostLight.match(/<path /g)).toHaveLength(2);
    expect(ghostDark.match(/<path /g)).toHaveLength(2);
  });

  it("ships the Wizzy identity and canonical domain", () => {
    expect(layout).toContain('const siteUrl = "https://wizzy.meme"');
    expect(layout).toContain('siteName: "Wizzy"');
    expect(portfolio).toContain('aria-label="Wizzy positions"');
    expect(portfolio).toContain("/brand/wizzy-mascot-dark.svg");
    expect(portfolio).not.toContain("/brand/una-mascot");
    expect(portfolio).toContain('href="https://x.com/wizzydotmeme"');
    expect(portfolio).toContain('aria-label="Follow Wizzy on X"');
    expect(css).toContain(".social-button .x-icon { fill: currentColor; stroke: none; }");
    expect(layout).toContain('site: "@wizzydotmeme"');
    expect(layout).toContain('creator: "@wizzydotmeme"');
  });

  it("ships a complete large social-share contract", () => {
    expect(layout).toContain('card: "summary_large_image"');
    expect(layout).toContain('locale: "en_GB"');
    expect(layout).toContain('url: "/brand/wizzy-social-unbounded-v1.png"');
    expect(layout.match(/images: \[socialImage\]/g)).toHaveLength(2);
    expect(socialCard.readUInt32BE(16)).toBe(1200);
    expect(socialCard.readUInt32BE(20)).toBe(630);
    expect(socialSource).toContain('font-family="Unbounded, sans-serif"');
    expect(socialRenderer).toContain('"assets", "fonts"');
    expect(xProfile.readUInt32BE(16)).toBe(400);
    expect(xBanner.readUInt32BE(16)).toBe(1500);
    expect(xBannerSource).toContain('id="wizzy-pattern"');
  });

  it("connects external wallets only, with no embedded or sponsored path", () => {
    expect(providers).toContain("WagmiProvider");
    expect(providers).toContain("QueryClientProvider");
    expect(wagmiConfig).toContain("injected()");
    expect(wagmiConfig).toContain("robinhoodChain, base");
    expect(wagmiConfig).toContain("robinhood-rpc.publicnode.com");
    expect(portfolio).toContain("Connect a wallet");
    expect(portfolio).toContain("Your wallet holds every position. Wizzy never takes custody.");
    expect(portfolio).toContain("connector.uid");
    expect(portfolio).not.toMatch(/privy|sponsor/i);
  });

  it("opens an accessible wallet menu with a native Robinhood ETH send flow", () => {
    expect(portfolio).toContain('aria-haspopup="menu"');
    expect(portfolio).toContain('role="menu"');
    expect(portfolio).toContain('role="menuitem"');
    expect(portfolio).toContain("robinhoodchain.blockscout.com/address/");
    expect(portfolio).toContain("Send ETH");
    expect(portfolio).toContain("handleMenuNavigation");
    expect(css).toContain(".wallet-menu-popover");
    expect(sendEthDialog).toContain('role="dialog"');
    expect(sendEthDialog).toContain("Paid by your wallet");
    expect(sendEthDialog).not.toContain("Sponsored");
    expect(sendEthDialog).toContain(">Max</button>");
    expect(css).toContain(".send-eth-backdrop { align-items: end");
    expect(shotFixture).not.toContain('chain: "solana"');
  });

  it("keeps custom RPC credentials on the server and caches the public market snapshot", () => {
    expect(marketsRoute).toContain("unstable_cache");
    expect(marketsRoute).toContain("max-age=0, s-maxage=30, stale-while-revalidate=60");
    expect(portfolio).toContain('fetch("/api/markets", { cache: "no-cache" })');
    expect(poolActivityRoute).toContain("unstable_cache");
    expect(poolActivitySource).toContain("rpcRequests: 2");
    expect(apiBoundary).toContain("same-origin request required");
    expect(apiBoundary).toContain("redactServerError");
    expect(balanceRoute).toContain("client.getBalance");
    expect(balanceRoute).toContain("process.env.ROBINHOOD_RPC_URL");
    expect(nextConfig).toContain("connect-src 'self' https://rpc.mainnet.chain.robinhood.com");
    expect(nextConfig).toContain("object-src 'none'");
    expect(nextConfig).toContain("frame-ancestors 'none'");
    expect(nextConfig).not.toContain("connect-src *");
  });

  it("models one selected market without index, basket, or chain-allocation contracts", () => {
    expect(allocationRoute).toContain("marketId: z.string().min(1)");
    expect(allocationRoute).not.toMatch(/marketIds|planDual|\"both\"/);
    expect(portfolioTypes).not.toMatch(/MemeIndex|DualChain|IndexMigration|weightBps/);
    expect(hostedBundle).not.toMatch(/index-plan|dual-chain|index-migration|index-selection/);
    expect(portfolioRoute).toContain("/api/portfolio/allocate or /api/portfolio/action");
    expect(existsSync("app/api/portfolio/index/route.ts")).toBe(false);
    expect(existsSync("src/portfolio/index-plan.ts")).toBe(false);
  });

  it("ships wallet-scoped XP and quests tied to confirmed product actions", () => {
    expect(portfolio).toContain("<AchievementCenter");
    expect(portfolio).toContain("confirmedEvm.transactionHashes");
    expect(achievementCenter).toContain('trackProductEvent("Quest Completed"');
    expect(achievementCenter).toContain('id="quest-board-title">Quests</h2>');
    expect(achievementCenter).toContain('role="dialog"');
    expect(achievementCenter).toContain("createPortal");
    expect(achievementsRoute).toContain("verifyOnchainQuestAction");
    expect(achievementsRoute).not.toContain("authorization");
    expect(telemetry).toContain('"achievements"');
    expect(css).toContain(".achievement-backdrop {\n  position: fixed;");
    expect(css).toContain(".trophy-case {\n  width: min(760px, 100%);");
    expect(css).toContain(".achievement-list { grid-template-columns: minmax(0, 1fr); }");
  });
});
