import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/page.tsx", "utf8");
const adminPage = readFileSync("app/admin/page.tsx", "utf8");
const portfolio = readFileSync("app/portfolio-app.tsx", "utf8");
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
const portfolioTypes = readFileSync("app/lib/portfolio-types.ts", "utf8");
const allocationSource = readFileSync("src/portfolio/allocation.ts", "utf8");
const achievementCenter = readFileSync("app/achievement-center.tsx", "utf8");
const achievementsRoute = readFileSync("app/api/achievements/route.ts", "utf8");
const telemetry = readFileSync("app/lib/telemetry.ts", "utf8");
const shotFixture = readFileSync("app/lib/shot-fixture.ts", "utf8");

describe("meme market maker UI", () => {
  it("exposes the full app at a passwordless, non-indexed admin route", () => {
    expect(adminPage).toContain("<PortfolioApp />");
    expect(adminPage).toContain("index: false");
    expect(adminPage).not.toMatch(/password|authenticate|redirect/i);
  });

  it("leads with one consumer market-making action and honest market evidence", () => {
    expect(page).toContain("coming-soon");
    expect(page).toContain("Coming soon");
    expect(page).not.toContain("PortfolioApp");
    expect(portfolio).toContain("Make Meme Markets");
    expect(portfolio).toContain("Add ETH to any listed market. Wizzy selects the best eligible pool, handles the swap, and creates the LP position in your wallet.");
    expect(portfolio).not.toContain("Pick a market. Add ETH. Own the position.");
    expect(portfolio).not.toContain("hero-token-field");
    expect(portfolio).toContain("Make market");
    expect(portfolio).toContain("<th>24h fee APR</th>");
    expect(portfolio).not.toContain("APY");
    expect(portfolio).not.toContain("Based on 24h fees");
    expect(portfolio).toContain("Meme markets");
    expect(portfolio).toContain("Reviewed every six hours.");
    expect(portfolio).toContain("In range");
    expect(portfolio).toContain('{ id: "markets", label: "Positions" }');
    expect(portfolio).toContain('id="positions"');
    expect(portfolio).toContain("Make market");
    expect(portfolio).toContain('aria-label="ETH amount"');
    expect(portfolio).toContain("Get {chainLabel(chain)} ETH");
    expect(portfolio).toContain("hasInsufficientBalance(amount, balance)");
    expect(portfolio).toContain("https://relay.link/bridge/base");
    expect(portfolio).toContain("https://relay.link/bridge/robinhood");
    expect(portfolio).not.toContain('name="sourceChain"');
    expect(portfolio).toContain('className="pair-cell"');
    expect(portfolio).not.toContain("Choose where your ETH is now");
    expect(portfolio).not.toContain("<select");
    expect(portfolio).toContain("See your positions");
    expect(portfolio).toContain("Connect to view value, fees, ranges, and available actions.");
    expect(portfolio).not.toContain("One wallet. Your markets.");
    expect(portfolio).not.toContain("empty-route");
    expect(portfolio).not.toContain('label: "Portfolio"');
    expect(portfolio).not.toContain("scrollIntoView");
    expect(portfolio).toContain('useState<"all" | ChainSlug>("robinhood")');
    expect(portfolio).not.toMatch(/GeckoTerminal|gecko-link|BRAND_ASSETS\.gecko|geckoPoolUrl/);
    expect(portfolio).toContain('const FOMO_REFERRER = "makemememarkets"');
    expect(portfolio).toContain("https://fomo.family/tokens/${chain}/${token.toLowerCase()}?r=${FOMO_REFERRER}");
    expect(portfolio).toContain("href={fomoTokenUrl(chain, market.token)}");
    expect(portfolio).not.toContain("https://fomo.family/r/");
    expect(portfolio).toContain("Trade on Fomo");
    expect(portfolio).toContain("Trade ${market.symbol}/WETH on Fomo");
    expect(portfolio).toContain("{zappable ? <a className=\"market-link fomo-link\"");
    expect(portfolio).not.toContain("market-link-external");
    expect(portfolio).not.toMatch(/app\.uniswap\.org|ReferenceLinks|uniswapSwapUrl/i);
    expect(portfolio).not.toMatch(/build your allocation|portfolio split|chain selector/i);
    expect(portfolio).not.toMatch(/autopilot|guaranteed returns|UnaBot/i);
    expect(portfolio).not.toMatch(/Observed, not forecast|Positions stay yours|Ask Una/i);
    expect(portfolio).not.toMatch(/one deposit · every market|self-custodial by design/i);
    expect(portfolio).not.toMatch(/Una is independent|not affiliated/i);
  });

  it("uses deliberate mobile layouts instead of shrinking desktop rows", () => {
    expect(css).not.toContain("hero-token-field");
    expect(css).toContain(".market-table tr { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr))");
    expect(css).toContain(".position-list article { grid-template-columns: repeat(2, minmax(0, 1fr)) auto");
    expect(css).toContain(".zap-dialog { width: min(100%, 328px);");
    expect(css).toContain(".portfolio-empty .empty-symbol { display: none; }");
    expect(css).toContain(".market-link-label { display: none; }");
    expect(portfolio).toContain("New positions appear here after they are confirmed.");
    expect(portfolio).toContain('className="empty-action"');
    expect(css).not.toContain('content: "Explore"');
  });

  it("keeps narrow-phone navigation, success panels, and actions reachable", () => {
    expect(css).toContain("@media (max-width: 360px)");
    expect(css).toContain(".wizzy-wordmark > span { position: absolute");
    expect(css).toContain(".social-button { display: none; }");
    expect(css).toContain(".action-preview.is-submitted { grid-template-columns: auto minmax(0, 1fr)");
    expect(css).toContain(".action-preview.is-submitted > .action-buttons { grid-column: 1 / -1; }");
    expect(css).toContain(".market-link { width: 48px; min-height: 48px");
    expect(css).toContain(".market-table .market-links { display: grid; grid-template-columns: minmax(0, 1fr) 48px;");
    expect(css).not.toContain(".market-table .market-links:has(.fomo-link)");
    expect(css).toContain(".position-manage,\n  .action-buttons button { min-height: 48px; }");
    expect(css).toContain(".empty-action { width: 100%; min-height: 48px");
  });

  it("pairs a characterful display face with a restrained trading UI", () => {
    expect(layout).toContain("Unbounded");
    expect(layout).toContain("Plus_Jakarta_Sans");
    expect(layout).toContain("@vercel/analytics/next");
    expect(layout).toContain("@vercel/speed-insights/next");
    expect(layout).toContain("<Analytics />");
    expect(layout).toContain("<SpeedInsights />");
    expect(layout).not.toContain("Bricolage_Grotesque");
    expect(layout).not.toContain("Instrument_Serif");
    expect(css).toContain("font-family: var(--font-display)");
    expect(css).toContain("--coral: #ff6f83");
    expect(css).toContain("--canvas: #09090d");
    expect(css).toContain("--surface: #111116");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(':root[data-theme="dark"]');
    expect(layout).toContain('localStorage.getItem("wizzy-theme")');
    expect(layout).toContain('localStorage.getItem("una-theme")');
    expect(layout).toContain('saved==="system"||saved==="light"||saved==="dark"?saved:"dark"');
    expect(portfolio).toContain('useState<ThemePreference>("dark")');
    expect(portfolio).toContain('window.localStorage.setItem("wizzy-theme", next)');
    expect(portfolio).toContain('Theme: ${capitalize(theme)}');
    expect(css).not.toMatch(/#FC72FF|#FF37C7|#ff007a/i);
    expect(css).not.toContain("Instrument Serif");
    expect(css).not.toMatch(/gradient/i);
  });

  it("reduces Wizzy to one oversized hooded head", () => {
    expect(mascot).toContain("single oversized hooded head");
    expect(mascot).toContain("M33 98C47 76 68 64 86 48");
    expect(mascot).toContain("M48 104C61 80 91 68 127 68");
    expect(mascot.match(/<path /g)).toHaveLength(2);
    expect(mascot).toContain('fill="#77e8c9"');
    expect(mascot).not.toMatch(/staff|crystal|hands|feet|stroke=/i);
  });

  it("keeps Wizzy eye-first at icon scale", () => {
    expect(mascot).toContain('rx="22" ry="32"');
    expect(mascot).toContain('rx="7" ry="10"');
    expect(mascot).not.toContain('rx="15.5" ry="22.5"');
    expect(mascot).not.toContain('rx="9" ry="13"');
  });

  it("keeps the hood pronounced without reintroducing a body or limbs", () => {
    expect(mascot).toContain("pronounced point and enormous mint eyes");
    expect(mascot).toContain("94 10C124 14 154 28 180 52");
    expect(mascot).not.toContain("M72 44C77 23 93 10 113 10");
    expect(mascot).not.toContain("M89 219c-3 3-4 8-1 11");
    expect(mascot).not.toContain("m221 11 20 23-20 25-18-25 18-23Z");
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
    expect(ghostLight).not.toMatch(/gradient|filter|text/i);
    expect(ghostDark).not.toMatch(/gradient|filter|text/i);
  });

  it("uses one live Markets surface differently before and after wallet connection", () => {
    expect(portfolio).toContain("const hasPortfolioAccess = authenticated || previewMode");
    expect(portfolio).toContain("Your positions");
    expect(portfolio).toContain("Connect your wallet to see positions on Base and Robinhood.");
    expect(portfolio).toContain("{positionLedger}");
    expect(portfolio).not.toContain('className="index-snapshot');
    expect(portfolio).not.toContain("Index composition");
    expect(portfolio).not.toContain("Curator weights");
    expect(portfolio).not.toContain("Weighted 24h fee pace");
    expect(portfolio).not.toContain("Visible markets");
    expect(portfolio).not.toContain("Across priced positions");
    expect(portfolio).not.toContain('className="portfolio-summary"');
    expect(portfolio).not.toContain("summarizePositions");
    expect(portfolio).toContain('action: "Connect wallet"');
    expect(css).toContain(".position-manager .action-preview");
    expect(css).toContain(".composition-track");
    expect(portfolio).toContain('className="position-composition"');
    expect(css).toContain(".market-pagination");
  });

  it("switches navigation immediately while keeping lightweight state motion", () => {
    expect(portfolio).not.toContain("startViewTransition");
    expect(portfolio).not.toContain("window.requestAnimationFrame");
    expect(portfolio).toContain("setTab(next)");
    expect(css).toContain("@keyframes view-arrive");
    expect(css).not.toContain("@keyframes index-segment-assemble");
    expect(css).toContain("@keyframes popover-open");
    expect(css).not.toContain("view-transition-name: wizzy-view");
    expect(portfolio).not.toContain('className="review-amount"');
  });

  it("supports Base and Robinhood market making while preserving self-custody", () => {
    expect(portfolio).toContain("Meme markets");
    expect(portfolio).toContain("Built on Base and Robinhood Chain");
    expect(portfolio).toContain("Base + Robinhood");
    expect(portfolio).toContain('chain === "base" || chain === "robinhood"');
    expect(portfolio).toContain("market-toolbar");
    expect(portfolio).toContain('aria-label="Search markets"');
    expect(portfolio).toContain("MARKETS_PER_PAGE");
    expect(portfolio).toContain("market.protocol");
    expect(portfolio).toContain('"Aerodrome Slipstream" : "Uniswap v3"');
    expect(portfolio).not.toContain("curated markets");
    expect(portfolio).toContain("Reviewed every six hours.");
    expect(portfolio).toContain('src={BRAND_ASSETS.robinhood}');
    expect(portfolio).toContain("Your wallet holds every position. Wizzy never takes custody.");
    expect(portfolio).not.toContain("Wizzy prepares the swap and range.");
    expect(portfolio).toContain("Your wallet holds every position. Wizzy never takes custody.");
    expect(portfolio).not.toContain("Your wallet owns the position</span>");
    expect(portfolio).toContain("Wizzy fee");
    expect(portfolio.match(/<dt>Wizzy fee<\/dt>/g)).toHaveLength(1);
    expect(portfolio).not.toContain('aria-label="Pool version"');
    expect(portfolio).not.toContain("protocolPickerOpen");
    expect(portfolio).not.toContain('protocol: zapProtocol');
    expect(portfolio).toContain("Best pool selected automatically");
    expect(portfolio).toContain("selected automatically</dd>");
    expect(portfolio).toContain("Add to this position");
    expect(portfolio).toContain('aria-label="ETH to add"');
    expect(portfolio).toContain('action === "increase"');
    expect(positionActionRoute).toContain('"collect", "compound", "increase", "rebalance", "withdraw"');
    expect(positionActionRoute).toContain("amountWei: z.string().regex(/^\\d+$/).optional()");
    expect(allocationRoute).toContain("selectBestMarketVenue(body.chain, body.marketId)");
    expect(allocationRoute).toContain('venueSelection.selectedKey === "V2" || venueSelection.selectedKey === "V4"');
    expect(allocationRoute).not.toContain('protocol: z.enum(["V2", "V3", "V4"])');
    expect(hostedBundle).toContain('selectBestMarketVenue } from "./markets/venue-observations.js"');
    expect(portfolio).toContain("planMarket.quoteSymbol");
    expect(css).not.toContain(".zap-protocol");
    expect(portfolio).not.toContain("Service fee");
    expect(portfolio).toContain('useState("0.05")');
    expect(portfolio).not.toContain("v{markets.catalog.version}");
    expect(portfolio).toContain('state.kind === "planning" ? "Quoting…" : "Review"');
    expect(portfolio).not.toContain("loading ? INDEX_MARKET_COUNT : constituentCount");
    expect(portfolio).toContain("market.id === zapMarketId");
    expect(portfolio).toContain('aria-modal="true"');
    expect(portfolio).toContain('aria-haspopup="dialog"');
    expect(portfolio).toContain('state.kind === "submitted" || state.kind === "error"');
    expect(portfolio).toContain("Ready to collect");
    expect(portfolio).not.toContain('className="portfolio-summary"');
    expect(portfolio).not.toContain("Your liquidity and the index, in one place.");
    expect(portfolio).not.toContain("Deposit ETH. Earn trading fees across Base, Robinhood, and Solana.");
    expect(css).toContain(".market-hero { grid-template-columns: 1fr; gap: 48px; padding: 68px 0 64px");
    expect(css).toMatch(/\.market-hero \{[\s\S]*?align-items: start;/);
    expect(css).toContain("min-height: 44px");
    expect(css).toContain(".cross-chain-fund");
    expect(portfolio).toContain('<small role="status">Balance');
    expect(css).toContain(".wallet-balance");
    expect(css).toContain("font-variant-numeric: tabular-nums");
    expect(balanceRoute).toContain("client.getBalance");
    expect(balanceRoute).toContain('parseChainSlug(params.get("chain"))');
    expect(balanceRoute).toContain("base-rpc.publicnode.com");
    expect(balanceRoute).toContain("process.env.ROBINHOOD_RPC_URL");
    expect(css).not.toContain(".index-update-panel");
    expect(portfolio).not.toContain("Index updated");
    expect(portfolio).not.toContain("/api/portfolio/migrate");
    expect(portfolio).toContain("sameAddress(zapPlan.owner, address)");
    expect(portfolio).toContain("const freshPlan = await requestAllocationPlan");
    expect(portfolio).toContain("const freshPlan = await requestPositionActionPlan");
    expect(portfolio).toContain("transactions: freshPlan.transactions");
    expect(portfolio).toContain('cache: "no-store"');
  });

  it("keeps wallet costs and preview data honest", () => {
    expect(sendEthDialog).toContain("Paid by your wallet");
    expect(sendEthDialog).not.toContain("Sponsored");
    expect(readFileSync("app/lib/shot-fixture.ts", "utf8")).not.toContain('chain: "solana"');
  });

  it("models one selected market without index, basket, or chain-allocation contracts", () => {
    expect(portfolio).toContain("marketId,");
    expect(portfolio).not.toContain("marketIds");
    expect(allocationRoute).toContain('chain: z.enum(["base", "robinhood"])');
    expect(allocationRoute).toContain("marketId: z.string().min(1)");
    expect(allocationRoute).not.toMatch(/marketIds|planDual|\"both\"/);
    expect(allocationSource).toContain("const markets = activeMarkets(input.chain, [input.marketId])");
    expect(allocationSource).toContain("const postSwapSqrtPriceX96 = quoteResult.result[1]");
    expect(allocationSource).toContain("tickCurrent: postSwapTick");
    expect(allocationSource).not.toContain("weightBps");
    expect(portfolioTypes).not.toMatch(/MemeIndex|DualChain|IndexMigration|weightBps/);
    expect(hostedBundle).not.toMatch(/index-plan|dual-chain|index-migration|index-selection/);
    expect(portfolioRoute).toContain("/api/portfolio/allocate or /api/portfolio/action");
    expect(existsSync("app/api/portfolio/index/route.ts")).toBe(false);
    expect(existsSync("app/api/portfolio/migrate/route.ts")).toBe(false);
    expect(existsSync("src/portfolio/index-plan.ts")).toBe(false);
    expect(existsSync("src/portfolio/dual-chain.ts")).toBe(false);
  });

  it("ships the Wizzy identity and canonical domain without stale public Una assets", () => {
    expect(layout).toContain('const siteUrl = "https://wizzy.meme"');
    expect(layout).toContain('const socialTitle = "Wizzy: Make Meme Markets"');
    expect(layout).toContain('siteName: "Wizzy"');
    expect(portfolio).toContain('aria-label="Wizzy overview"');
    expect(portfolio).toContain('/brand/wizzy-mascot-dark.svg');
    expect(portfolio).not.toContain('/brand/una-mascot');
    expect(mascot).toContain("Wizzy mascot");
  });

  it("links the official Wizzy X account in the app and share metadata", () => {
    expect(portfolio).toContain('href="https://x.com/wizzydotmeme"');
    expect(portfolio).toContain('aria-label="Follow Wizzy on X"');
    expect(portfolio).toContain('title="@wizzydotmeme on X"');
    expect(portfolio).toContain('className="x-icon"');
    expect(css).toContain(".social-button .x-icon { fill: currentColor; stroke: none; }");
    expect(layout).toContain('site: "@wizzydotmeme"');
    expect(layout).toContain('creator: "@wizzydotmeme"');
  });

  it("ships a complete large social-share contract", () => {
    expect(layout).toContain('card: "summary_large_image"');
    expect(layout).toContain('url: "/"');
    expect(layout).toContain('locale: "en_GB"');
    expect(layout).toContain('"max-image-preview": "large"');
    expect(layout).toContain("Pick a reviewed meme pool on Base or Robinhood, add ETH, and own the liquidity position.");
    expect(layout).not.toContain("curated index");
    expect(layout).toContain('url: "/brand/wizzy-social-unbounded-v1.png"');
    expect(layout.match(/images: \[socialImage\]/g)).toHaveLength(2);
    expect(socialCard.readUInt32BE(16)).toBe(1200);
    expect(socialCard.readUInt32BE(20)).toBe(630);
    expect(socialCard.byteLength).toBeLessThan(5 * 1024 * 1024);
    expect(layout).toMatch(/alt: "Wizzy mascot.+Make Meme Markets.+earn trading fees/);
    expect(socialSource).toContain('font-family="Unbounded, sans-serif"');
    expect(socialSource).toContain('font-family="Plus Jakarta Sans, Arial, sans-serif"');
    expect(socialRenderer).toContain('"assets", "fonts"');
    expect(socialRenderer).toContain("process.env.FONTCONFIG_FILE");
  });

  it("ships upload-ready X profile art", () => {
    expect(xProfile.readUInt32BE(16)).toBe(400);
    expect(xProfile.readUInt32BE(20)).toBe(400);
    expect(xProfile.byteLength).toBeLessThan(2 * 1024 * 1024);
    expect(xBanner.readUInt32BE(16)).toBe(1500);
    expect(xBanner.readUInt32BE(20)).toBe(500);
    expect(xBannerSource).toContain('id="wizzy-pattern"');
    expect(xBannerSource).toContain('fill="url(#wizzy-pattern)"');
    expect(xBannerSource).toContain('href="#pattern-wizzy"');
    expect(xBannerSource).not.toContain("<text");
    expect(xBannerSource).not.toContain("@WIZZYDOTFUN");
  });

  it("connects external wallets only, with no embedded or sponsored path", () => {
    expect(providers).toContain("WagmiProvider");
    expect(providers).toContain("QueryClientProvider");
    expect(wagmiConfig).toContain("injected()");
    expect(wagmiConfig).toContain("robinhoodChain, base");
    expect(wagmiConfig).toContain("robinhood-rpc.publicnode.com");
    expect(portfolio).toContain("Connect a wallet");
    expect(portfolio).toContain("Wizzy never takes custody.");
    expect(portfolio).toContain("connector.uid");
    expect(portfolio).not.toContain("privy");
    expect(portfolio).not.toContain("Privy");
    expect(portfolio).not.toContain("sponsor");
  });

  it("opens an accessible wallet menu with a native Robinhood ETH send flow", () => {
    expect(portfolio).toContain('aria-haspopup="menu"');
    expect(portfolio).toContain('role="menu"');
    expect(portfolio).toContain('role="menuitem"');
    expect(portfolio).toContain("robinhoodchain.blockscout.com/address/");
    expect(portfolio).toContain("Send ETH");
    expect(portfolio).toContain("On Robinhood Chain");
    expect(portfolio).toContain("Your onchain activity");
    expect(portfolio).toContain("Disconnect");
    expect(portfolio).toContain('event.key !== "Escape"');
    expect(portfolio).toContain("handleMenuNavigation");
    expect(css).toContain(".wallet-menu-popover");
    expect(sendEthDialog).toContain('role="dialog"');
    expect(sendEthDialog).toContain('aria-modal="true"');
    expect(sendEthDialog).toContain("Review transfer");
    expect(sendEthDialog).toContain("Network fee paid from your wallet");
    expect(sendEthDialog).toContain(">Max</button>");
    expect(sendEthDialog).toContain("View transaction");
    expect(css).toContain(".send-eth-dialog");
    expect(css).toContain(".send-eth-backdrop { align-items: end");
  });

  it("keeps custom RPC credentials on the server and caches the public market snapshot", () => {
    expect(marketsRoute).toContain("unstable_cache");
    expect(marketsRoute).toContain("max-age=0, s-maxage=30, stale-while-revalidate=60");
    expect(marketsRoute).toContain('["wizzy-markets-v3", String(catalog.version)]');
    expect(portfolio).toContain('fetch("/api/markets", { cache: "no-cache" })');
    expect(marketsRoute).not.toContain("index: indexState.policy");
    expect(marketsRoute).not.toContain("registry: indexState.registry");
    expect(marketsRoute).not.toContain("Robinhood index");
    expect(poolActivityRoute).toContain("unstable_cache");
    expect(poolActivityRoute).toContain('dynamic = "force-dynamic"');
    expect(poolActivityRoute).toContain("s-maxage=60, stale-while-revalidate=300");
    expect(apiBoundary).toContain("same-origin request required");
    expect(apiBoundary).toContain("Buffer.byteLength");
    expect(apiBoundary).toContain("redactServerError");
    expect(nextConfig).not.toContain("https://api.mainnet-beta.solana.com");
    expect(nextConfig).not.toContain("wss://api.mainnet-beta.solana.com");
  });

  it("shows restrained activity from one shared multi-pool RPC scan", () => {
    expect(portfolio).toContain('aria-label="Pool activity"');
    expect(portfolio).toContain('fetch("/api/pool-activity"');
    expect(portfolio).toContain("POOL_ACTIVITY_REFRESH_MS = 60_000");
    expect(portfolio).toContain('document.visibilityState === "hidden"');
    expect(css).toMatch(/\.market-nav \{[\s\S]*?z-index: 2;/);
    expect(css).toMatch(/\.pool-activity \{[\s\S]*?z-index: 1;/);
    expect(css).toContain("@keyframes pool-activity-scroll");
    expect(css).toContain('.pool-activity-group[aria-hidden="true"]');
    expect(poolActivitySource).toContain('activeMarkets("robinhood")');
    expect(poolActivitySource).toContain("env.activityRpcUrl || env.rpcByChain.robinhood");
    expect(poolActivitySource).toContain("const BLOCK_WINDOW = 1_000n");
    expect(poolActivitySource).toContain("events: [V3_MINT_EVENT, V3_BURN_EVENT]");
    expect(poolActivitySource).toContain("address: markets.map((market) => market.pool)");
    expect(poolActivitySource).toContain("rpcRequests: 2");
    expect(poolActivitySource).not.toContain("batch:");
    expect(poolActivitySource).not.toMatch(/getTransaction|getBlock\(/);
  });

  it("allows remote asset artwork without weakening executable or connection policies", () => {
    expect(nextConfig).toContain("img-src * data: blob:");
    expect(nextConfig).toContain(
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    );
    expect(nextConfig).toContain("connect-src 'self' https://rpc.mainnet.chain.robinhood.com");
    expect(nextConfig).not.toContain("privy");
    expect(nextConfig).toContain("object-src 'none'");
    expect(nextConfig).toContain("frame-ancestors 'none'");
    expect(nextConfig).not.toContain("script-src *");
    expect(nextConfig).not.toContain("connect-src *");
  });

  it("clears the completed deposit celebration after an ETH withdrawal", () => {
    expect(portfolio).toContain('if (freshPlan.kind === "withdraw")');
    expect(portfolio).toContain('setZapState({ kind: "idle" });');
  });

  it("ends completed loaders and clears the successful deposit amount without showing a balance error", () => {
    expect(portfolio).toContain('setZapPlan(null);');
    expect(portfolio).toContain('setZapState({ kind: "idle" })');
    // zap flow shows progress through button copy, not a plan loader
    expect(portfolio).not.toContain('{busy ? <div className="plan-loading"');
    expect(portfolio).not.toContain('</> : <div className="plan-loading"><i /><i /><i /></div>}');
  });

  it("matches live position artwork by pool and offers compact range controls for every concentrated position", () => {
    expect(portfolio).toContain("positionTokenImage(position, markets, stats)");
    expect(portfolio).toContain("market.pool.toLowerCase() === position.pool.toLowerCase()");
    expect(portfolio).toContain('const canAdjustRange = (position.protocol === "V3" || position.protocol === "V4") && position.chain !== "solana" && !position.closed');
    expect(positionActionRoute).toContain('z.enum(["collect", "compound", "increase", "rebalance", "withdraw"])');
    expect(positionActionRoute).toContain('rangePreset: z.enum(["focused", "balanced", "wide"]).optional()');
    expect(portfolio).toContain('className="position-manager" id={id} aria-label={`Manage ${position.pair}`}');
    expect(portfolio).toContain('className={`position-list-item ${expanded ? "is-expanded" : ""}`}');
    expect(portfolio).toContain('aria-expanded={expanded} aria-controls={managerId}');
    expect(portfolio).not.toContain('className="position-manager-backdrop"');
    expect(css).not.toContain(".position-manager-backdrop");
    expect(portfolio).toContain('onAction(position, "collect")');
    expect(portfolio).toContain('onAction(position, "rebalance", rangePreset)');
    expect(portfolio).toContain('role="group" aria-label="Range width"');
    expect(portfolio).toContain("Full range by design.");
    expect(portfolio).toContain('actionState.kind === "idle" ? <footer className={`position-manager-actions ${addOpen ? "is-adding" : ""}`}>');
    expect(portfolio).toContain("positionRangePreviewForTicks(position, plannedRange.tickLower, plannedRange.tickUpper, plannedRange.currentTick)");
    expect(portfolio).toContain('!canAdjustRange && !canAdd && !position.closed ? <button className="position-primary-action position-withdraw-action"');
    expect(portfolio).toContain("Ticks {previousTickLower}–{previousTickUpper} → {preview.tickLower}–{preview.tickUpper}");
    expect(portfolio).not.toContain("same-width range centred");
    expect(shotFixture).toContain('fee: 2111');
    expect(shotFixture).toContain('feeLabel: "0.21%"');
  });

  it("keeps withdrawal confirmation concise and removes the fee from success rows", () => {
    expect(portfolio).toContain("Close this position and return at least");
    expect(portfolio).toContain('plan && state.kind === "ready"');
    expect(portfolio).not.toContain("one atomic approval.`");
  });

  it("does not promise ETH for V2 or V4 withdrawals", () => {
    expect(portfolio).toContain("positionSettlesToEth(position)");
    expect(portfolio).toContain('position.protocol !== "V2"');
    expect(portfolio).toContain('freshPlan.settlement?.asset === "ETH"');
  });

  it("ships wallet-scoped XP and quests tied to confirmed product actions", () => {
    expect(portfolio).toContain("<AchievementCenter");
    expect(portfolio).toContain("confirmedEvm.transactionHashes");
    expect(portfolio).toContain("transactionHashes,");
    expect(achievementCenter).toContain('trackProductEvent("Quest Completed"');
    expect(achievementCenter).toContain('trackProductEvent("Quest Board Opened"');
    expect(achievementCenter).toContain('id="quest-board-title">Quests</h2>');
    expect(achievementCenter).toContain("Quest complete");
    expect(achievementCenter).toContain("quests complete.");
    expect(achievementCenter).not.toContain("Trophy case");
    expect(achievementCenter).not.toContain("Trophy unlocked");
    expect(achievementCenter).toContain('role="dialog"');
    expect(achievementCenter).toContain('aria-modal="true"');
    expect(achievementCenter).toContain('role="progressbar"');
    expect(achievementCenter).toContain("createPortal");
    expect(achievementCenter).toContain("(triggerRef.current ?? previouslyFocused)?.focus()");
    expect(achievementCenter).toContain('fetch("/api/achievements"');
    expect(achievementsRoute).toContain("verifyOnchainQuestAction");
    expect(achievementsRoute).toContain("walletAddresses: [owner]");
    expect(achievementsRoute).toContain("isAddress(value)");
    expect(achievementsRoute).not.toContain("verifyAuthToken");
    expect(achievementsRoute).not.toContain("authorization");
    expect(telemetry).toContain('"achievements"');
  });

  it("keeps the quest board usable across desktop, mobile, themes, and reduced motion", () => {
    expect(css).toContain(".achievement-backdrop {\n  position: fixed;");
    expect(css).toContain(".trophy-case {\n  width: min(760px, 100%);");
    expect(css).toContain(".quest-sections { display: grid; gap: 28px;");
    expect(css).toContain(".achievement-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(css).toContain(".trophy-case { width: 100%; max-height: calc(100dvh - 16px);");
    expect(css).toContain(".quest-sections { gap: 22px; padding: 0 18px 24px;");
    expect(css).toContain(".achievement-list { grid-template-columns: minmax(0, 1fr);");
    expect(css).toContain(".achievement-toast-mascot i,");
    expect(css).toContain(".achievement-progress i,");
  });
});
