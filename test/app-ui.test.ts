import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/page.tsx", "utf8");
const portfolio = readFileSync("app/portfolio-app.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");
const providers = readFileSync("app/providers.tsx", "utf8");
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
const solanaWallet = readFileSync("app/lib/solana-wallet.ts", "utf8");
const solanaBroadcast = readFileSync("app/api/portfolio/solana/broadcast/route.ts", "utf8");
const marketsRoute = readFileSync("app/api/markets/route.ts", "utf8");
const poolActivityRoute = readFileSync("app/api/pool-activity/route.ts", "utf8");
const poolActivitySource = readFileSync("src/markets/activity.ts", "utf8");
const apiBoundary = readFileSync("app/lib/api-request-server.ts", "utf8");
const balanceRoute = readFileSync("app/api/balance/route.ts", "utf8");
const positionActionRoute = readFileSync("app/api/portfolio/action/route.ts", "utf8");
const achievementCenter = readFileSync("app/achievement-center.tsx", "utf8");
const achievementsRoute = readFileSync("app/api/achievements/route.ts", "utf8");
const telemetry = readFileSync("app/lib/telemetry.ts", "utf8");

describe("meme index product UI", () => {
  it("leads with one consumer market-making action and honest market evidence", () => {
    expect(page).toContain("PortfolioApp");
    expect(portfolio).toContain("Make Meme Markets");
    expect(portfolio).toContain("Deposit ETH into a curated index of meme markets and earn.");
    expect(portfolio).toContain("Updated and managed by agents.");
    expect(portfolio).toContain("Make markets");
    expect(portfolio).toContain("Fee APR");
    expect(portfolio).toContain("Based on 24h fees");
    expect(portfolio).toContain("Robinhood Wizzy Index");
    expect(portfolio).toContain("Earning now");
    expect(portfolio).toContain('{ id: "markets", label: "Markets" }');
    expect(portfolio).toContain('id="positions"');
    expect(portfolio).toContain("More with a larger deposit");
    expect(portfolio).toContain('name="depositAmount"');
    expect(portfolio).toContain("ETH on another chain?");
    expect(portfolio).toContain("Bridge to your Wizzy account.");
    expect(portfolio).toContain("useAddFunds");
    expect(portfolio).toContain('chain: "eip155:4663"');
    expect(portfolio).not.toContain('name="sourceChain"');
    expect(portfolio).toContain('className="market-stack" role="img"');
    expect(portfolio).not.toContain("Choose where your ETH is now");
    expect(portfolio).not.toContain("<select");
    expect(portfolio).toContain("Reveal your markets");
    expect(portfolio).toContain("Connect to see position value, fees, range status, and index updates.");
    expect(portfolio).not.toContain("One wallet. Your markets.");
    expect(portfolio).not.toContain("empty-route");
    expect(portfolio).not.toContain('label: "Positions"');
    expect(portfolio).not.toContain("scrollIntoView");
    expect(portfolio).toContain("https://www.geckoterminal.com/robinhood/pools");
    expect(portfolio).toContain("View ${market.symbol}/WETH on GeckoTerminal");
    expect(portfolio).toContain("https://fomo.family/r/makemememarkets");
    expect(portfolio).toContain("Trade on Fomo");
    expect(portfolio).toContain("Trade ${market.symbol}/WETH on Fomo");
    expect(portfolio).not.toContain("market-link-external");
    expect(portfolio).not.toMatch(/app\.uniswap\.org|ReferenceLinks|uniswapSwapUrl/i);
    expect(portfolio).not.toMatch(/build your allocation|portfolio split|chain selector/i);
    expect(portfolio).not.toMatch(/autopilot|guaranteed returns|UnaBot/i);
    expect(portfolio).not.toMatch(/Observed, not forecast|Positions stay yours|Ask Una/i);
    expect(portfolio).not.toMatch(/one deposit · every market|self-custodial by design/i);
    expect(portfolio).not.toMatch(/Una is independent|not affiliated/i);
  });

  it("uses deliberate mobile layouts instead of shrinking desktop rows", () => {
    expect(css).toContain("grid-template-columns: repeat(6, minmax(0, 1fr))");
    expect(css).toContain(".market-output { display: grid");
    expect(css).toContain(".market-table tr { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr))");
    expect(css).toContain(".position-list article { grid-template-columns: repeat(3, minmax(0, 1fr))");
    expect(css).toContain(".portfolio-empty .empty-symbol { display: none; }");
    expect(css).toContain(".market-link-label { display: none; }");
    expect(portfolio).toContain("Your markets will live here.");
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
    expect(css).toContain(".position-actions button,\n  .action-buttons button { min-height: 48px; }");
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
    expect(portfolio).toContain('hasPortfolioAccess ? "Your markets" : "The live index"');
    expect(portfolio).toContain("{hasPortfolioAccess ? positionLedger : null}");
    expect(portfolio).toContain("{!hasPortfolioAccess ? positionLedger : null}");
    expect(portfolio).toContain('className="index-snapshot');
    expect(portfolio).toContain("Index composition");
    expect(portfolio).toContain("Curator weights");
    expect(portfolio).toContain("Across the index");
    expect(portfolio).toContain('action: "Connect wallet"');
    expect(css).toContain(".composition-track");
    expect(css).toContain("grid-template-columns: repeat(6, minmax(0, 1fr))");
  });

  it("switches navigation immediately while keeping lightweight state motion", () => {
    expect(portfolio).not.toContain("startViewTransition");
    expect(portfolio).not.toContain("window.requestAnimationFrame");
    expect(portfolio).toContain("setTab(next)");
    expect(css).toContain("@keyframes view-arrive");
    expect(css).toContain("@keyframes index-segment-assemble");
    expect(css).toContain("@keyframes popover-open");
    expect(css).not.toContain("view-transition-name: wizzy-view");
    expect(portfolio).not.toContain('className="review-amount"');
  });

  it("keeps the launch surface Robinhood-specific while preserving self-custody", () => {
    expect(portfolio).toContain("Robinhood Wizzy Index");
    expect(portfolio).toContain("Built on Robinhood Chain");
    expect(portfolio).not.toContain("curated markets");
    expect(portfolio).toContain("Wizzy agents regularly review which markets qualify.");
    expect(portfolio).toContain("Actively curated as meme markets change.");
    expect(portfolio).toContain('src={BRAND_ASSETS.robinhood}');
    expect(portfolio).toContain("Self-custodial");
    expect(portfolio).toContain("One approval opens every position.");
    expect(portfolio).toContain('useState("1.00")');
    expect(portfolio).toContain('chain: "eip155:4663"');
    expect(portfolio).not.toContain("v{markets.catalog.version}");
    expect(portfolio).toContain('loading ? "Reading markets"');
    expect(portfolio).not.toContain("loading ? INDEX_MARKET_COUNT : constituentCount");
    expect(portfolio).toContain('planState.kind !== "submitted" || !plan');
    expect(portfolio).toContain('state.kind === "submitted" && plan ? plan.constituentCount : markets.length');
    expect(portfolio).toContain("Ready to collect");
    expect(portfolio).toContain('positions.length === 1 ? "position" : "positions"');
    expect(portfolio).not.toContain("Your liquidity and the index, in one place.");
    expect(portfolio).not.toContain("Deposit ETH. Earn trading fees across Base, Robinhood, and Solana.");
    expect(css).toContain(".index-hero { grid-template-columns: 1fr; gap: 48px; padding: 68px 0 64px");
    expect(css).toMatch(/\.index-hero \{[\s\S]*?align-items: start;/);
    expect(css).toContain("min-height: 44px");
    expect(css).toContain(".cross-chain-fund");
    expect(portfolio).toContain("Robinhood Chain ETH balance");
    expect(portfolio).toContain("<EthereumIcon />");
    expect(css).toContain(".wallet-balance");
    expect(css).toContain("font-variant-numeric: tabular-nums");
    expect(balanceRoute).toContain("client.getBalance");
    expect(balanceRoute).toContain("process.env.ROBINHOOD_RPC_URL");
    expect(css).toContain(".index-update-panel");
    expect(portfolio).toContain("Index updated");
    expect(portfolio).toContain("Update position");
    expect(portfolio).toContain("/api/portfolio/migrate");
    expect(portfolio).toContain("sameAddress(plan.owner, address)");
    expect(portfolio).toContain("owner: plan.owner");
    expect(portfolio).toContain("owner: actionPlan.owner");
    expect(portfolio).toContain("owner: migrationPlan.owner");
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
    expect(layout).toContain("earn trading fees, managed by agents on Robinhood Chain");
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

  it("offers wallet-first login and provisions EVM and Solana wallets for every user", () => {
    expect(providers).toContain('loginMethods: ["wallet", "email"]');
    expect(providers).toContain('ethereum: { createOnLogin: "all-users" }');
    expect(providers).toContain('solana: { createOnLogin: "all-users" }');
    expect(providers).toContain("toSolanaWalletConnectors");
    expect(providers).toContain("solana: { connectors: solanaConnectors }");
    expect(providers).toContain("defaultChain: robinhoodChain");
    expect(providers).not.toContain("NEXT_PUBLIC_SOLANA_RPC_URL");
    expect(providers).not.toContain("NEXT_PUBLIC_SOLANA_WS_URL");
    expect(providers).not.toContain("createSolanaRpc");
  });

  it("opens an accessible wallet menu for Privy management and disconnect", () => {
    expect(portfolio).toContain('aria-haspopup="menu"');
    expect(portfolio).toContain('role="menu"');
    expect(portfolio).toContain('role="menuitem"');
    expect(portfolio).toContain('href="https://home.privy.io/"');
    expect(portfolio).toContain("Send funds or export keys");
    expect(portfolio).toContain("Disconnect");
    expect(portfolio).toContain('event.key !== "Escape"');
    expect(portfolio).toContain("handleMenuNavigation");
    expect(css).toContain(".wallet-menu-popover");
  });

  it("keeps custom RPC credentials on the server and caches the public market snapshot", () => {
    expect(solanaWallet).not.toContain("NEXT_PUBLIC_SOLANA_RPC_URL");
    expect(solanaWallet).toContain('/api/portfolio/solana/broadcast');
    expect(solanaBroadcast).toContain("getSolanaConnection");
    expect(solanaBroadcast).toContain("verifySignatures: true");
    expect(marketsRoute).toContain("unstable_cache");
    expect(marketsRoute).toContain("s-maxage=30, stale-while-revalidate=300");
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
    expect(css).toMatch(/\.index-nav \{[\s\S]*?z-index: 2;/);
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
    expect(nextConfig).toContain("connect-src 'self' https://auth.privy.io");
    expect(nextConfig).toContain("object-src 'none'");
    expect(nextConfig).toContain("frame-ancestors 'none'");
    expect(nextConfig).not.toContain("script-src *");
    expect(nextConfig).not.toContain("connect-src *");
  });

  it("clears the completed deposit celebration after an ETH withdrawal", () => {
    expect(portfolio).toContain('if (actionPlan.kind === "withdraw")');
    expect(portfolio).toContain('setPlanState({ kind: "idle" });');
  });

  it("ends completed loaders and clears the successful deposit amount without showing a balance error", () => {
    expect(portfolio).toContain('setAmount("");');
    expect(portfolio).toContain('state.kind === "submitted" ? null : amountError');
    expect(portfolio).toContain('{busy ? <div className="plan-loading"');
    expect(portfolio).not.toContain('</> : <div className="plan-loading"><i /><i /><i /></div>}');
  });

  it("matches live position artwork by pool and offers an out-of-range rebalance", () => {
    expect(portfolio).toContain("positionTokenImage(position, markets, stats)");
    expect(portfolio).toContain("market.pool.toLowerCase() === position.pool.toLowerCase()");
    expect(portfolio).toContain('needsRebalance ? "Rebalance" : "Compound"');
    expect(positionActionRoute).toContain('z.enum(["compound", "rebalance", "withdraw"])');
  });

  it("keeps withdrawal confirmation concise and removes the fee from success rows", () => {
    expect(portfolio).toContain("Close this position and return at least");
    expect(portfolio).toContain('actionPlan && actionState.kind === "ready"');
    expect(portfolio).not.toContain("one atomic approval.`");
  });

  it("ships wallet-scoped XP and quests tied to confirmed product actions", () => {
    expect(portfolio).toContain("<AchievementCenter");
    expect(portfolio).toContain("confirmedTransactionHashes(confirmedEvm)");
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
    expect(achievementsRoute).toContain("verifyAuthToken");
    expect(achievementsRoute).toContain("setCustomMetadata");
    expect(achievementsRoute).toContain("verifyOnchainQuestAction");
    expect(achievementsRoute).not.toContain('"record" in body');
    expect(achievementsRoute).not.toContain("userId: body");
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
