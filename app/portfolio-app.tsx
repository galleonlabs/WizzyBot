"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useAddFunds, useAuthorizationSignature, usePrivy, useWallets } from "@privy-io/react-auth";
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
  type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana";
import { formatEther, parseEther } from "viem";
import { lightRowToView, priceLabel, type PositionView } from "./lib/cards";
import { readJsonPayload } from "./lib/api-payload";
import { positionFeesEth, positionValueEth, positionValueUsd, summarizePositions } from "./lib/portfolio-summary";
import { type ChainSlug } from "./lib/chains";
import {
  type CuratedMarket,
  type AllocationMarketPlan,
  type AllocationPlan,
  type MarketsPayload,
  type MarketStats,
  type PoolActivityItem,
  type PoolActivityPayload,
  type RobinhoodIndexBreadthPolicy,
  type RobinhoodIndexBreadthTier,
  type RobinhoodIndexPlan,
  type IndexMigrationPlan,
  type PositionActionPlan,
  type SolanaCuratedMarket,
} from "./lib/portfolio-types";
import { type SolanaPositionActionPlan } from "./lib/solana-position-server";
import { isShotQuery, SHOT_VIEWS } from "./lib/shot-fixture";
import { confirmedTransactionHashes, sendPrivyWalletCallsAndWait, sendWalletCallsAndWait, type ConnectedEvmWallet, type ConfirmedCallsSubmission, type WalletTransaction } from "./lib/wallet-calls";
import { PRIVY_APP_ID } from "./lib/privy-config";
import { reportClientError, trackProductEvent } from "./lib/telemetry-client";
import { AchievementCenter } from "./achievement-center";
import { SendEthDialog } from "./send-eth-dialog";
import type { AchievementActionEvidence } from "./lib/achievements";

type ViewTab = "overview" | "markets";
type ThemePreference = "system" | "light" | "dark";
type PlanState = { kind: "idle" | "planning" | "ready" | "signing" | "waiting" | "submitted" | "error"; message?: string };
type BalanceState = { kind: "idle" | "loading" | "ready" | "error"; balanceWei?: string };
type AnyPositionActionPlan = PositionActionPlan | SolanaPositionActionPlan;
type PositionActionKind = "compound" | "rebalance" | "withdraw";
type IndexChain = ChainSlug | "solana";
type IndexMarket = {
  market: CuratedMarket | SolanaCuratedMarket;
  chain: IndexChain;
  indexWeightBps: number;
};
type AvailableIndexUpdate = {
  migrationId: string;
  position: PositionView;
  fromSymbol: string;
  toSymbol: string;
};
const INDEX_MARKET_COUNT = 6;
const FOMO_URL = "https://fomo.family/r/makemememarkets";
const ROBINHOOD_NATIVE_ETH = "0x0000000000000000000000000000000000000000";
const POOL_ACTIVITY_REFRESH_MS = 60_000;
const PREVIEW_POOL_ACTIVITY: PoolActivityItem[] = [
  { id: "preview-1", kind: "added", marketId: "robinhood-pons", symbol: "PONS", pair: "PONS/WETH", wethAmount: "9.34", transactionHash: "0xpreview", transactionUrl: "#", blockNumber: "3" },
  { id: "preview-2", kind: "removed", marketId: "robinhood-ai", symbol: "AI", pair: "AI/WETH", wethAmount: "0.61", transactionHash: "0xpreview", transactionUrl: "#", blockNumber: "2" },
  { id: "preview-3", kind: "added", marketId: "robinhood-cashcat", symbol: "CASHCAT", pair: "CASHCAT/WETH", wethAmount: "1.82", transactionHash: "0xpreview", transactionUrl: "#", blockNumber: "1" },
];
const PREVIEW_WITHDRAWAL_PLAN: PositionActionPlan = {
  kind: "withdraw",
  owner: "0x1111111111111111111111111111111111111111",
  chain: "robinhood",
  chainId: 4663,
  tokenId: "941",
  pair: "CASHCAT/WETH",
  expectedConfirmations: 1,
  serviceFeeBps: 15,
  serviceFee: [],
  settlement: { asset: "ETH", minimumAmountWei: "19118000000000000", marketSymbol: "CASHCAT" },
  transactions: [],
  createdAt: "2026-08-30T00:00:00.000Z",
  expiresAt: "2099-08-30T00:00:00.000Z",
  notices: [],
};
const BRAND_ASSETS = {
  base: "https://assets.relay.link/icons/8453/light.png",
  robinhood: "https://assets.relay.link/icons/4663/light.png",
  solana: "https://assets.relay.link/icons/792703809/light.png",
  fomo: "https://fomo.family/favicon.svg",
  gecko: "https://www.geckoterminal.com/favicon.ico",
} as const;

const EMPTY_MARKETS: MarketsPayload = {
  catalog: { version: 1, updatedAt: "", fees: { allocateBps: 15, withdrawBps: 15, rebalanceBps: 15, compoundBps: 200 }, migrations: [], chains: [] },
  solana: {
    slug: "solana",
    chainId: 792703809,
    label: "Solana",
    accent: "#8b5cf6",
    minimumAllocationLamports: "300000000",
    gasReserveLamports: "25000000",
    markets: [],
  },
  index: {
    chain: "robinhood",
    breadthUnitWei: "20000000000000000",
    minimumAmountWei: "20000000000000000",
    maximumConstituents: INDEX_MARKET_COUNT,
    tiers: [],
    selectionRules: { minimumPoolAgeDays: 30, minimumLiquidityUsd: 75_000, quoteSymbol: "WETH", venue: "Uniswap v3" },
  },
  fundingChains: [{ id: 8453, label: "Base" }, { id: 4663, label: "Robinhood Chain" }],
  stats: [],
  source: "",
};

export function PortfolioApp() {
  const { ready, authenticated, login, logout, user, getAccessToken } = usePrivy();
  const { addFunds } = useAddFunds();
  const { generateAuthorizationSignature } = useAuthorizationSignature();
  const { wallets } = useWallets();
  const { ready: solanaReady, wallets: solanaWallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const [tab, setTab] = useState<ViewTab>("overview");
  const [theme, setTheme] = useState<ThemePreference>("dark");
  const [fundingState, setFundingState] = useState<PlanState>({ kind: "idle" });
  const [balanceState, setBalanceState] = useState<BalanceState>({ kind: "idle" });
  const [markets, setMarkets] = useState<MarketsPayload>(EMPTY_MARKETS);
  const [marketsState, setMarketsState] = useState<"loading" | "ready" | "error">("loading");
  const [positions, setPositions] = useState<PositionView[]>([]);
  const [positionsState, setPositionsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [previewMode, setPreviewMode] = useState(false);
  const [actionPlan, setActionPlan] = useState<AnyPositionActionPlan | null>(null);
  const [actionState, setActionState] = useState<PlanState>({ kind: "idle" });
  const [migrationPlan, setMigrationPlan] = useState<IndexMigrationPlan | null>(null);
  const [migrationState, setMigrationState] = useState<PlanState>({ kind: "idle" });
  const [zapMarketId, setZapMarketId] = useState<string | null>(null);
  const [zapAmount, setZapAmount] = useState("0.05");
  const [zapPlan, setZapPlan] = useState<AllocationPlan | null>(null);
  const [zapState, setZapState] = useState<PlanState>({ kind: "idle" });
  const [sendOpen, setSendOpen] = useState(false);
  const positionsRequestRef = useRef(0);
  const balanceRequestRef = useRef(0);
  const authStateRef = useRef<"loading" | "signed-in" | "signed-out">("loading");
  const achievementActionRef = useRef<((evidence: AchievementActionEvidence) => Promise<void>) | null>(null);

  const wallet = useMemo(() => {
    const preferred = user?.wallet?.address?.toLowerCase();
    return wallets.find((candidate) => candidate.address.toLowerCase() === preferred) ?? wallets[0];
  }, [user?.wallet?.address, wallets]);
  const solanaWallet = useMemo(() => solanaWallets.find((candidate) => candidate.standardWallet.name.toLowerCase().includes("privy")) ?? solanaWallets[0], [solanaWallets]);
  const address = wallet?.address ?? user?.wallet?.address;
  const solanaAddress = solanaWallet?.address;
  const privyWalletId = useMemo(() => {
    if (!address) return null;
    const accounts = [user?.wallet, ...(user?.linkedAccounts ?? [])] as unknown[];
    for (const account of accounts) {
      if (!account || typeof account !== "object") continue;
      const record = account as Record<string, unknown>;
      if (typeof record.address !== "string" || record.address.toLowerCase() !== address.toLowerCase()) continue;
      if (typeof record.id === "string" && record.id.length >= 8) return record.id;
    }
    return null;
  }, [address, user?.linkedAccounts, user?.wallet]);

  async function sendEvmBatch(input: {
    owner: string;
    chainId: number;
    transactions: readonly WalletTransaction[];
    intent?: "send-eth";
    onSubmitted?: () => void;
  }) {
    if (!wallet) throw new Error("Your wallet is not ready");
    if (input.chainId === 4663) {
      if (!privyWalletId) throw new Error("Your Privy wallet is still initializing. Refresh once, then try again.");
      return sendPrivyWalletCallsAndWait({
        walletId: privyWalletId,
        appId: PRIVY_APP_ID,
        owner: input.owner,
        walletAddress: wallet.address,
        chainId: 4663,
        transactions: input.transactions,
        intent: input.intent,
        generateAuthorizationSignature,
        onSubmitted: input.onSubmitted,
      });
    }
    return sendWalletCallsAndWait({
      wallet: wallet as unknown as ConnectedEvmWallet,
      owner: input.owner,
      chainId: input.chainId,
      transactions: input.transactions,
      onSubmitted: input.onSubmitted,
    });
  }

  const loadRobinhoodBalance = useCallback(async () => {
    const requestId = ++balanceRequestRef.current;
    if (!authenticated || !address) {
      setBalanceState({ kind: "idle" });
      return;
    }
    setBalanceState({ kind: "loading" });
    try {
      const response = await fetch(`/api/balance?address=${encodeURIComponent(address)}`, { cache: "no-store" });
      const payload = await readJsonPayload(response) as { balanceWei?: string; error?: string };
      if (!response.ok || payload.balanceWei === undefined) throw new Error(payload.error ?? "Could not read balance");
      if (requestId !== balanceRequestRef.current) return;
      setBalanceState({ kind: "ready", balanceWei: payload.balanceWei });
    } catch (error) {
      if (requestId !== balanceRequestRef.current) return;
      setBalanceState({ kind: "error" });
      reportClientError("positions", error);
    }
  }, [address, authenticated]);

  async function sendRobinhoodEth(recipient: `0x${string}`, amountWei: string, onSubmitted: () => void): Promise<`0x${string}` | null> {
    if (!address) throw new Error("Your Wizzy wallet is not ready.");
    trackProductEvent("ETH Send Started", { chainId: 4663 });
    try {
      const confirmed = await sendEvmBatch({
        owner: address,
        chainId: 4663,
        intent: "send-eth",
        transactions: [{ to: recipient, data: "0x", value: amountWei, description: "Send ETH on Robinhood Chain" }],
        onSubmitted,
      });
      const transactionHash = confirmedTransactionHashes(confirmed.status)[0] ?? null;
      await loadRobinhoodBalance();
      trackProductEvent("ETH Send Confirmed", { chainId: 4663, transactionHash });
      return transactionHash;
    } catch (error) {
      reportClientError("send-eth", error);
      throw error;
    }
  }

  const loadPositions = useCallback(async () => {
    const requestId = ++positionsRequestRef.current;
    if (!authenticated || !address) {
      setPositions([]);
      setPositionsState("idle");
      return;
    }
    setPositionsState("loading");
    try {
      const requests = (["base", "robinhood"] as const).map(async (chain) => {
        const response = await fetch(`/api/positions?owner=${encodeURIComponent(address)}&chain=${chain}`);
        const payload = await readJsonPayload(response) as { positions?: unknown[]; error?: string };
        if (!response.ok || payload.error) throw new Error(payload.error ?? `Could not load ${chain} positions`);
        return payload.positions ?? [];
      });
      if (solanaReady && solanaAddress) requests.push((async () => {
        const response = await fetch(`/api/portfolio/solana/positions?owner=${encodeURIComponent(solanaAddress)}`);
        const payload = await readJsonPayload(response) as { positions?: unknown[]; error?: string };
        if (!response.ok || payload.error) throw new Error(payload.error ?? "Could not load Solana positions");
        return payload.positions ?? [];
      })());
      const payloads = await Promise.all(requests);
      if (requestId !== positionsRequestRef.current) return;
      const next = payloads.flat().map((row) => row && typeof row === "object" ? lightRowToView(row as Record<string, unknown>) : null)
        .filter((row): row is PositionView => Boolean(row));
      setPositions(next);
      setPositionsState("ready");
    } catch (error) {
      if (requestId !== positionsRequestRef.current) return;
      setPositions([]);
      setPositionsState("error");
      reportClientError("positions", error);
    }
  }, [address, authenticated, solanaAddress, solanaReady]);

  useEffect(() => {
    const saved = window.localStorage.getItem("wizzy-theme") ?? window.localStorage.getItem("una-theme");
    if (saved === "system" || saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const next = authenticated ? "signed-in" : "signed-out";
    if (authStateRef.current !== next) {
      trackProductEvent(authenticated ? "Session Restored" : "Session Ready", { authenticated });
      authStateRef.current = next;
    }
  }, [authenticated, ready]);

  useEffect(() => {
    void loadRobinhoodBalance();
  }, [loadRobinhoodBalance]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("view");
    if (requested === "markets" || requested === "positions") setTab("markets");
    if (isShotQuery()) {
      setPreviewMode(true);
      setPositions(SHOT_VIEWS);
      setPositionsState("ready");
      const previewState = params.get("state");
      if (previewState === "deposit-success") {
        setZapState({ kind: "submitted", message: "Market made. Your position NFT is in your wallet." });
      }
      if (previewState === "withdraw-ready" || previewState === "withdraw-success") {
        setActionPlan(PREVIEW_WITHDRAWAL_PLAN);
        setActionState({
          kind: previewState === "withdraw-ready" ? "ready" : "submitted",
          message: previewState === "withdraw-ready" ? "Review the ETH return before continuing." : "Your ETH is back in your wallet.",
        });
      }
    }
    fetch("/api/markets")
      .then(async (response) => {
        const payload = await readJsonPayload(response) as MarketsPayload;
        if (!response.ok) throw new Error("Could not load markets");
        setMarkets(payload);
        setMarketsState("ready");
      })
      .catch((error) => {
        setMarketsState("error");
        reportClientError("markets", error);
      });
  }, []);

  useEffect(() => {
    if (!previewMode && !isShotQuery()) void loadPositions();
  }, [loadPositions, previewMode]);

  useEffect(() => {
    if (previewMode || isShotQuery()) return;
    setZapPlan(null);
    setZapState({ kind: "idle" });
    setActionPlan(null);
    setActionState({ kind: "idle" });
    setMigrationPlan(null);
    setMigrationState({ kind: "idle" });
    setFundingState({ kind: "idle" });
  }, [address, authenticated, previewMode]);

  const activeMarkets = useMemo<IndexMarket[]>(() => {
    const robinhood = markets.catalog.chains.find((chain) => chain.slug === "robinhood");
    return robinhood?.markets
      .filter((market) => market.status === "active")
      .map((market) => ({ market, chain: "robinhood" as const, indexWeightBps: market.weightBps })) ?? [];
  }, [markets]);
  const stats = useMemo(() => new Map(markets.stats.map((row) => [row.marketId, row])), [markets.stats]);
  const availableIndexUpdates = useMemo<AvailableIndexUpdate[]>(() => {
    const robinhood = markets.catalog.chains.find((chain) => chain.slug === "robinhood");
    if (!robinhood) return [];
    const symbols = new Map(robinhood.markets.map((market) => [market.id, market.symbol]));
    return markets.catalog.migrations
      .filter((migration) => Date.parse(migration.effectiveAt) <= Date.now())
      .flatMap((migration) => positions
      .filter((position) => position.chain === "robinhood" && !position.closed && position.marketId === migration.fromMarketId && position.tokenId)
      .map((position) => ({
        migrationId: migration.id,
        position,
        fromSymbol: symbols.get(migration.fromMarketId) ?? position.symbol0,
        toSymbol: symbols.get(migration.toMarketId) ?? "the new market",
      })));
  }, [markets.catalog, positions]);
  const hasPortfolioAccess = authenticated || previewMode;

  function changeTab(next: ViewTab) {
    if (next === tab) return;
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  function cycleTheme() {
    const next: ThemePreference = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
    setTheme(next);
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("wizzy-theme", next);
    } catch {
      // The selected theme still applies for this session when storage is unavailable.
    }
    const existingMeta = document.getElementById("wizzy-theme-color");
    if (next === "system") existingMeta?.remove();
    else {
      const meta = existingMeta ?? document.head.appendChild(document.createElement("meta"));
      meta.id = "wizzy-theme-color";
      meta.setAttribute("name", "theme-color");
      meta.setAttribute("content", next === "dark" ? "#09090d" : "#f8f5ef");
    }
  }

  function startLogin(source: "header" | "make-markets" | "markets") {
    trackProductEvent("Login Started", { source });
    try {
      login();
    } catch (error) {
      reportClientError("auth", error);
    }
  }

  async function fundRobinhood() {
    if (!authenticated || !address) {
      startLogin("make-markets");
      return;
    }
    setFundingState({ kind: "planning", message: "Opening Privy funding…" });
    trackProductEvent("Cross-chain Funding Started", { destinationChainId: 4663 });
    try {
      const result = await addFunds({
        destination: {
          address,
          chain: "eip155:4663",
          asset: ROBINHOOD_NATIVE_ETH,
        },
        crypto: { slippageBps: 100 },
      });
      if (result.method !== "crypto" || result.status !== "completed") {
        throw new Error("Privy did not complete the crypto deposit");
      }
      setFundingState({ kind: "submitted", message: "ETH arrived on Robinhood Chain. You can make markets now." });
      trackProductEvent("Cross-chain Funding Completed", { destinationChainId: 4663 });
      await loadRobinhoodBalance();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not add ETH";
      if (message.includes("USER_EXITED")) {
        setFundingState({ kind: "idle" });
        return;
      }
      setFundingState({ kind: "error", message: "Privy could not route that deposit. Try another supported chain or asset." });
      reportClientError("cross-chain-funding", error);
    }
  }

  async function preparePositionAction(position: PositionView, action: PositionActionKind) {
    if (!address || !position.tokenId || !position.chain) return;
    setActionPlan(null);
    setActionState({ kind: "planning", message: `${action === "compound" ? "Preparing to reinvest" : action === "rebalance" ? "Preparing a new range for" : "Preparing to withdraw"} ${position.pair}…` });
    try {
      const isSolana = position.chain === "solana";
      if (isSolana && action === "rebalance") throw new Error("Solana rebalancing is not available yet");
      if (isSolana && (!solanaWallet || !position.marketId)) throw new Error("Your Solana wallet is not ready");
      const response = await fetch(isSolana ? "/api/portfolio/solana/action" : "/api/portfolio/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(isSolana ? {
          owner: solanaWallet!.address,
          marketId: position.marketId,
          position: position.tokenId,
          action,
        } : {
          owner: address,
          chain: position.chain,
          tokenId: position.tokenId,
          action,
          venue: position.venue,
          positionManager: position.positionManager,
        }),
      });
      const payload = await readJsonPayload(response) as { plan?: AnyPositionActionPlan; error?: string };
      if (!response.ok || !payload.plan) throw new Error(payload.error ?? `Could not prepare ${action}`);
      setActionPlan(payload.plan);
      setActionState({ kind: "ready", message: action === "compound" ? "Review the fees ready to reinvest." : action === "rebalance" ? "Review the new range before continuing." : "Review the ETH return before continuing." });
    } catch (error) {
      setActionState({ kind: "error", message: error instanceof Error ? error.message : `Could not prepare ${action}` });
      reportClientError("position-action", error);
    }
  }

  async function executePositionAction() {
    if (!actionPlan || !wallet || !address) return;
    if (Date.now() >= Date.parse(actionPlan.expiresAt)) {
      setActionState({ kind: "error", message: "This quote expired. Prepare it again." });
      return;
    }
    try {
      let confirmedEvm: ConfirmedCallsSubmission | null = null;
      setActionState({ kind: "signing", message: "Approve this position update in your wallet." });
      if (actionPlan.chain === "solana") {
        if (!solanaWallet) throw new Error("Your Solana wallet is not ready");
        const { executeSolanaPositionAction } = await import("./lib/solana-wallet");
        await executeSolanaPositionAction({
          plan: actionPlan,
          wallet: solanaWallet as ConnectedStandardSolanaWallet,
          signTransaction,
          onProgress: ({ step, total, label }) => setActionState({
            kind: step === 0 ? "signing" : "waiting",
            message: step === 0 ? "Approve the Solana position update." : `${label} · ${step} of ${total}`,
          }),
        });
      } else {
        confirmedEvm = await sendEvmBatch({
          owner: actionPlan.owner,
          chainId: actionPlan.chainId,
          transactions: actionPlan.transactions,
          onSubmitted: () => setActionState({
            kind: "waiting",
            message: actionPlan.kind === "withdraw" ? "Closing the position and returning ETH…" : actionPlan.kind === "rebalance" ? "Moving liquidity into the new range…" : "Reinvesting your fees…",
          }),
        });
      }
      await Promise.all([loadPositions(), loadRobinhoodBalance()]);
      if (actionPlan.kind === "withdraw") {
        // The exit invalidates the earlier zap celebration. Returning to Make
        // must show a fresh form, never a stale "Market made" state.
        setZapPlan(null);
        setZapState({ kind: "idle" });
      }
      setActionState({
        kind: "submitted",
        message: actionPlan.kind === "withdraw" ? "Your ETH is back in your wallet." : actionPlan.kind === "rebalance" ? "Your position is earning in its new range." : "Your fees are back at work.",
      });
      if ((actionPlan.kind === "compound" || actionPlan.kind === "rebalance") && actionPlan.chain === "robinhood" && confirmedEvm) {
        const transactionHashes = confirmedTransactionHashes(confirmedEvm);
        if (transactionHashes.length) void achievementActionRef.current?.({
          action: actionPlan.kind,
          chainId: 4663,
          tokenId: actionPlan.tokenId,
          transactionHashes,
        });
      }
      trackProductEvent(actionPlan.kind === "withdraw" ? "Withdrawal Confirmed" : actionPlan.kind === "rebalance" ? "Rebalance Confirmed" : "Compound Confirmed", { chainId: actionPlan.chainId });
    } catch (error) {
      setActionState({ kind: "error", message: error instanceof Error ? error.message : "Wallet submission failed" });
      reportClientError("position-action", error);
    }
  }

  async function prepareIndexMigration(update: AvailableIndexUpdate) {
    if (!address || !update.position.tokenId) return;
    setMigrationPlan(null);
    setMigrationState({ kind: "planning", message: `Quoting ${update.fromSymbol} → ${update.toSymbol}…` });
    try {
      const response = await fetch("/api/portfolio/migrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: address, tokenId: update.position.tokenId, migrationId: update.migrationId }),
      });
      const payload = await readJsonPayload(response) as { plan?: IndexMigrationPlan; error?: string };
      if (!response.ok || !payload.plan) throw new Error(payload.error ?? "Could not prepare the index update");
      setMigrationPlan(payload.plan);
      setMigrationState({ kind: "ready", message: "Review the replacement and fee before updating." });
    } catch (error) {
      setMigrationState({ kind: "error", message: error instanceof Error ? error.message : "Could not prepare the index update" });
      reportClientError("index-migration", error);
    }
  }

  async function executeIndexMigration() {
    if (!migrationPlan || !wallet || !address) return;
    if (Date.now() >= Date.parse(migrationPlan.expiresAt)) {
      setMigrationState({ kind: "error", message: "This update quote expired. Prepare it again." });
      return;
    }
    try {
      setMigrationState({ kind: "signing", message: "Approve this index update in your wallet." });
      await sendEvmBatch({
        owner: migrationPlan.owner,
        chainId: migrationPlan.chainId,
        transactions: migrationPlan.transactions,
        onSubmitted: () => setMigrationState({ kind: "waiting", message: "Robinhood is confirming the index update…" }),
      });
      await loadPositions();
      setMigrationState({ kind: "submitted", message: "Your position now matches the latest curated index." });
      trackProductEvent("Index Migration Confirmed", { chainId: migrationPlan.chainId, migrationId: migrationPlan.migrationId });
    } catch (error) {
      setMigrationState({ kind: "error", message: error instanceof Error ? error.message : "The index update could not be submitted" });
      reportClientError("index-migration", error);
    }
  }

  function openZap(marketId: string) {
    if (!authenticated) {
      startLogin("markets");
      return;
    }
    setZapMarketId((current) => current === marketId ? null : marketId);
    setZapPlan(null);
    setZapState({ kind: "idle" });
    trackProductEvent("Zap Opened", { marketId });
  }

  async function prepareZap(marketId: string) {
    if (!address) return;
    let amountWei: bigint;
    try {
      amountWei = parseEther(zapAmount || "0");
    } catch {
      setZapState({ kind: "error", message: "Enter a valid ETH amount." });
      return;
    }
    setZapState({ kind: "planning", message: "Quoting the pool…" });
    setZapPlan(null);
    try {
      const response = await fetch("/api/portfolio/allocate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: address, chain: "robinhood", amountWei: amountWei.toString(), marketIds: [marketId] }),
      });
      const payload = await readJsonPayload(response) as { plan?: AllocationPlan; error?: string };
      if (!response.ok || !payload.plan) throw new Error(payload.error ?? "Could not quote this market");
      setZapPlan(payload.plan);
      setZapState({ kind: "ready", message: "Review the position, then confirm in your wallet." });
      trackProductEvent("Zap Quote Ready", { marketId });
    } catch (error) {
      setZapState({ kind: "error", message: error instanceof Error ? error.message : "Could not quote this market" });
      reportClientError("index-plan", error);
    }
  }

  async function executeZap() {
    if (!zapPlan || !address || !wallet) return;
    if (!sameAddress(zapPlan.owner, address) || !sameAddress(zapPlan.owner, wallet.address)) {
      setZapPlan(null);
      setZapState({ kind: "error", message: "Your wallet changed. Review a fresh quote before continuing." });
      return;
    }
    if (Date.now() >= Date.parse(zapPlan.expiresAt)) {
      setZapState({ kind: "error", message: "This quote expired. Quote it again." });
      return;
    }
    try {
      setZapState({ kind: "signing", message: "Approve the market in your wallet." });
      await sendEvmBatch({
        owner: zapPlan.owner,
        chainId: zapPlan.chainId,
        transactions: zapPlan.transactions,
        onSubmitted: () => setZapState({ kind: "waiting", message: "Robinhood is confirming your market…" }),
      });
      await loadPositions();
      setZapState({ kind: "submitted", message: "Market made. Your position NFT is in your wallet." });
      setZapPlan(null);
      trackProductEvent("Zap Confirmed", { marketId: zapMarketId });
    } catch (error) {
      setZapState({ kind: "error", message: error instanceof Error ? error.message : "The market could not be made" });
      reportClientError("index-submit", error);
    }
  }

  const positionLedger = (
    <PositionLedger
      authenticated={hasPortfolioAccess}
      positions={positions}
      state={positionsState}
      markets={activeMarkets}
      stats={stats}
      onStart={() => hasPortfolioAccess ? changeTab("overview") : startLogin("markets")}
      onRetry={() => void loadPositions()}
      onAction={preparePositionAction}
      actionPlan={actionPlan}
      actionState={actionState}
      onExecute={executePositionAction}
      onCancel={() => { setActionPlan(null); setActionState({ kind: "idle" }); }}
      updates={availableIndexUpdates}
      migrationPlan={migrationPlan}
      migrationState={migrationState}
      onPrepareMigration={(update) => void prepareIndexMigration(update)}
      onExecuteMigration={() => void executeIndexMigration()}
      onCancelMigration={() => { setMigrationPlan(null); setMigrationState({ kind: "idle" }); }}
    />
  );
  const indexLedger = (
    <section className="index-section index-catalog">
      <header className="section-title">
        <div><h2>Robinhood Wizzy Index</h2><p>Actively curated as meme markets change.</p></div>
      </header>
      <MarketLedger
        markets={activeMarkets}
        stats={stats}
        state={marketsState}
        policy={markets.index}
        zapMarketId={zapMarketId}
        zapAmount={zapAmount}
        zapPlan={zapPlan}
        zapState={zapState}
        onOpenZap={openZap}
        onZapAmount={(next) => { setZapAmount(next); setZapPlan(null); if (zapState.kind !== "idle") setZapState({ kind: "idle" }); }}
        onPrepareZap={(id) => void prepareZap(id)}
        onExecuteZap={() => void executeZap()}
        onCloseZap={() => { setZapMarketId(null); setZapPlan(null); setZapState({ kind: "idle" }); }}
        balance={authenticated ? balanceState : null}
        fundingState={fundingState}
        onFund={() => void fundRobinhood()}
      />
    </section>
  );

  return (
    <main className="index-app">
      <div className="wizzy-atmosphere" aria-hidden="true">
        <span className="wizzy-ghost wizzy-ghost-1" />
        <span className="wizzy-ghost wizzy-ghost-2" />
        <span className="wizzy-ghost wizzy-ghost-3" />
        <span className="wizzy-ghost wizzy-ghost-4" />
        <span className="wizzy-ghost wizzy-ghost-5" />
        <span className="wizzy-ghost wizzy-ghost-6" />
      </div>
      <div className="nav-stack">
        <header className="index-nav">
          <button className="wizzy-wordmark" type="button" onClick={() => changeTab("overview")} aria-label="Wizzy overview">
            <picture className="wizzy-mark" aria-hidden="true">
              {theme === "system" ? <source media="(prefers-color-scheme: dark)" srcSet="/brand/wizzy-mascot-dark.svg" /> : null}
              <img src={theme === "dark" ? "/brand/wizzy-mascot-dark.svg" : "/brand/wizzy-mascot-light.svg"} alt="" />
            </picture>
            <span>Wizzy</span>
          </button>
          <nav aria-label="Primary navigation">
            {([{ id: "overview", label: "Make" }, { id: "markets", label: "Portfolio" }] as const).map((item) => (
              <button key={item.id} type="button" className={tab === item.id ? "is-active" : ""} onClick={() => changeTab(item.id)}>{item.label}</button>
            ))}
          </nav>
          <div className="nav-actions">
            <AchievementCenter
              address={address}
              authenticated={authenticated}
              positionsState={positionsState}
              getAccessToken={getAccessToken}
              onConnect={() => startLogin("header")}
              preview={previewMode}
              actionRef={achievementActionRef}
            />
            <a className="social-button" href="https://x.com/wizzydotmeme" target="_blank" rel="noreferrer" aria-label="Follow Wizzy on X" title="@wizzydotmeme on X" onClick={() => trackProductEvent("X Opened", { location: "header" })}>
              <XIcon />
            </a>
            <button className="theme-button" type="button" onClick={cycleTheme} aria-label={`Theme: ${capitalize(theme)}. Switch to ${theme === "dark" ? "light" : theme === "light" ? "system" : "dark"}.`} title={`Theme: ${capitalize(theme)}`}>
              <ThemeIcon preference={theme} />
            </button>
            {!ready ? <span className="wallet-skeleton" /> : authenticated ? (
              <WalletMenu address={address ?? "Wallet"} onSend={() => { setSendOpen(true); void loadRobinhoodBalance(); trackProductEvent("ETH Send Opened", { chainId: 4663 }); }} onDisconnect={() => { trackProductEvent("Logout Started"); void logout(); }} />
            ) : (
              <button className="wallet-button wallet-connect" type="button" onClick={() => startLogin("header")} aria-label="Connect wallet"><WalletIcon /><span>Connect</span></button>
            )}
          </div>
        </header>
        <PoolActivityStrip preview={previewMode} />
      </div>

      {previewMode ? <div className="preview-banner">Illustrative preview · development only</div> : null}

      <div className="index-shell" data-view={tab}>
          {tab === "overview" ? (
            <section className="index-hero">
                <div className="hero-stage">
                  <div className="hero-copy">
                    <h1>Make Meme Markets</h1>
                    <p>Pick a meme market. One amount, one confirmation, real LP fees.<br /><span>Curated and watched by agents around the clock.</span></p>
                  </div>
                  <IndexShowcase markets={activeMarkets} stats={stats} loading={marketsState === "loading"} />
                </div>
            </section>
          ) : null}
          {tab === "overview" ? (
            <section className="index-main markets-view home-markets">
              {indexLedger}
            </section>
          ) : (
            <section className="index-main markets-view">
              <header className="index-title-row">
                <div><h1>{hasPortfolioAccess ? "Your markets" : "The live index"}</h1><p>{hasPortfolioAccess ? (positions.length ? `${positions.length} position${positions.length === 1 ? "" : "s"} in this wallet.` : "Your wallet is connected. New positions appear here.") : "Wizzy agents regularly review which markets qualify."}</p></div>
              </header>
              {positionLedger}
            </section>
          )}
      </div>
      {address ? <SendEthDialog open={sendOpen} owner={address} balanceWei={balanceState.kind === "ready" ? balanceState.balanceWei : undefined} onClose={() => setSendOpen(false)} onSend={sendRobinhoodEth} /> : null}
    </main>
  );
}

function PoolActivityStrip({ preview }: { preview: boolean }) {
  const [activity, setActivity] = useState<PoolActivityPayload>({ state: "ready", items: [], asOfBlock: null, scannedBlocks: 0, rpcRequests: 2 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (preview) {
      setActivity({ state: "ready", items: PREVIEW_POOL_ACTIVITY, asOfBlock: "preview", scannedBlocks: 0, rpcRequests: 2 });
      setLoading(false);
      return;
    }
    let active = true;
    let request: AbortController | null = null;
    let pending = false;

    const load = async () => {
      if (document.visibilityState === "hidden" || pending) return;
      pending = true;
      request?.abort();
      request = new AbortController();
      const timeout = window.setTimeout(() => request?.abort(), 8_000);
      try {
        const response = await fetch("/api/pool-activity", { signal: request.signal });
        const payload = await readJsonPayload(response) as PoolActivityPayload;
        if (!response.ok) throw new Error("Could not load pool activity");
        if (active) setActivity((current) => payload.state === "ready" || !current.items.length ? payload : current);
      } catch {
        if (active) setActivity((current) => current.items.length ? current : { state: "unavailable", items: [], asOfBlock: null, scannedBlocks: 0, rpcRequests: 2 });
      } finally {
        window.clearTimeout(timeout);
        pending = false;
        if (active) setLoading(false);
      }
    };
    const refresh = window.setInterval(() => { void load(); }, POOL_ACTIVITY_REFRESH_MS);
    const onVisibility = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisibility);
    void load();
    return () => {
      active = false;
      request?.abort();
      window.clearInterval(refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [preview]);

  const duration = `${Math.max(36, activity.items.length * 7)}s`;
  return <section className={`pool-activity is-${activity.state}`} aria-label="Pool activity">
    <span className="pool-activity-label">Pool activity</span>
    <div className="pool-activity-window">
      {activity.items.length ? <div className="pool-activity-track" style={{ "--activity-duration": duration } as CSSProperties}>
        <PoolActivityGroup items={activity.items} />
        <PoolActivityGroup items={activity.items} duplicate />
      </div> : <span className="pool-activity-status">{loading ? "Reading active pools" : activity.state === "unavailable" ? "Temporarily unavailable" : "No recent adds or removals"}</span>}
    </div>
  </section>;
}

function PoolActivityGroup({ items, duplicate = false }: { items: PoolActivityItem[]; duplicate?: boolean }) {
  return <span className="pool-activity-group" aria-hidden={duplicate ? "true" : undefined}>
    {items.map((item) => {
      const content = <>
        <span className="pool-activity-kind"><i aria-hidden="true">{item.kind === "added" ? "+" : "−"}</i>{item.kind === "added" ? "Added" : "Removed"}</span>
        <strong>{item.pair}</strong>
        {item.wethAmount ? <span>{item.wethAmount} ETH</span> : null}
        {!duplicate ? <ExternalLinkIcon /> : null}
      </>;
      return duplicate
        ? <span className="pool-activity-item" data-kind={item.kind} key={`duplicate-${item.id}`}>{content}</span>
        : <a className="pool-activity-item" data-kind={item.kind} href={item.transactionUrl} target="_blank" rel="noreferrer" title={`View ${item.kind} liquidity transaction for ${item.pair}`} key={item.id}>{content}</a>;
    })}
  </span>;
}

function IndexShowcase({ markets, stats, loading }: { markets: IndexMarket[]; stats: Map<string, MarketStats>; loading: boolean }) {
  return <div className="index-showcase" aria-label="Robinhood Wizzy Index">
    <div className="network-lockup" aria-label="Built on Robinhood Chain">
      <img src={BRAND_ASSETS.robinhood} alt="" />
      <span className="network-name"><small>Built on</small><b>Robinhood Chain</b></span>
    </div>
    <div className={`hero-token-field ${loading ? "is-loading" : ""}`}>
      {(loading ? Array.from({ length: INDEX_MARKET_COUNT }, (_, index) => ({ market: { id: String(index), symbol: "", color: "" } })) : markets).map(({ market }, index) => (
        <span className="hero-token" key={market.id} style={{ "--token-index": index } as CSSProperties}>
          <TokenIcon symbol={market.symbol} src={stats.get(market.id)?.tokenImageUrl} color={market.color} />
          {market.symbol ? <b>{market.symbol}</b> : null}
        </span>
      ))}
    </div>
  </div>;
}

function WalletMenu({ address, onSend, onDisconnect }: { address: string; onSend: () => void; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return <div className="wallet-menu-root" ref={rootRef}>
    <button ref={triggerRef} className="wallet-button" type="button" onClick={() => setOpen((current) => !current)} aria-label={`Wallet ${short(address)}`} aria-haspopup="menu" aria-expanded={open} aria-controls="wallet-menu">
      <WalletIcon /><span>{short(address)}</span><ChevronIcon />
    </button>
    {open ? <div className="wallet-menu-popover" id="wallet-menu" role="menu" aria-label="Wallet menu" onKeyDown={handleMenuNavigation}>
      <header>
        <img src="/brand/wizzy-mascot-32.png" alt="" />
        <span><small>Your Wizzy wallet</small><b>{short(address)}</b></span>
      </header>
      <div className="wallet-menu-actions">
        <button type="button" role="menuitem" onClick={() => { setOpen(false); onSend(); }}>
          <SendIcon /><span><b>Send ETH</b><small>On Robinhood Chain</small></span>
        </button>
        <a href="https://home.privy.io/" target="_blank" rel="noreferrer" role="menuitem" onClick={() => setOpen(false)}>
          <WalletIcon /><span><b>Manage</b><small>Export keys and security</small></span><ExternalLinkIcon />
        </a>
        <button type="button" role="menuitem" onClick={() => { setOpen(false); onDisconnect(); }}>
          <DisconnectIcon /><span><b>Disconnect</b><small>Sign out of Wizzy</small></span>
        </button>
      </div>
    </div> : null}
  </div>;
}

function handleMenuNavigation(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (!(["ArrowDown", "ArrowUp", "Home", "End"] as string[]).includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  if (!items.length) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowUp" ? (current - 1 + items.length) % items.length : (current + 1) % items.length;
  items[next]?.focus();
}

function SuccessCelebration({ label }: { label: string }) {
  return <div className="success-celebration" role="img" aria-label={label}>
    <span className="success-spark success-spark-1" /><span className="success-spark success-spark-2" /><span className="success-spark success-spark-3" /><span className="success-spark success-spark-4" />
    <img src="/brand/wizzy-mascot-dark.svg" alt="" />
    <span className="success-check"><CheckIcon /></span>
  </div>;
}

function MarketLedger({ markets, stats, state, policy, zapMarketId, zapAmount, zapPlan, zapState, onOpenZap, onZapAmount, onPrepareZap, onExecuteZap, onCloseZap, balance, fundingState, onFund }: {
  markets: IndexMarket[];
  stats: Map<string, MarketStats>;
  state: "loading" | "ready" | "error";
  policy: RobinhoodIndexBreadthPolicy;
  zapMarketId: string | null;
  zapAmount: string;
  zapPlan: AllocationPlan | null;
  zapState: PlanState;
  onOpenZap: (marketId: string) => void;
  onZapAmount: (next: string) => void;
  onPrepareZap: (marketId: string) => void;
  onExecuteZap: () => void;
  onCloseZap: () => void;
  balance: BalanceState | null;
  fundingState: PlanState;
  onFund: () => void;
}) {
  const orderedMarkets = [...markets].sort(
    (a, b) => marketTierIndex(policy, a.market.id) - marketTierIndex(policy, b.market.id) || b.indexWeightBps - a.indexWeightBps,
  );
  return (
    <section className="market-ledger">
      <div className="market-table-wrap">
        <IndexSnapshot markets={orderedMarkets} stats={stats} state={state} />
        <table className="market-table">
          <thead><tr><th>Market</th><th>Fee APR</th><th>24h volume</th><th>Liquidity</th><th>Explore</th></tr></thead>
          <tbody>
            {state === "loading" ? Array.from({ length: INDEX_MARKET_COUNT }, (_, index) => <tr className="skeleton-row" key={index}><td colSpan={5}><i /></td></tr>) : null}
            {state === "error" ? <tr><td colSpan={5} className="table-message">Market data is temporarily unavailable.</td></tr> : null}
            {state === "ready" ? orderedMarkets.flatMap(({ market, chain }) => {
              const row = stats.get(market.id);
              const zappable = chain === "robinhood";
              const isOpen = zappable && zapMarketId === market.id;
              const rows = [<tr key={market.id} className={isOpen ? "is-zapping" : ""}>
                <td><span className="pair-cell"><TokenIcon symbol={market.symbol} src={row?.tokenImageUrl} color={market.color} /><span><b>{market.symbol}/WETH</b><VenueTrail chain={chain} /></span></span></td>
                <td><b className="fee-apr">{formatFeeApr(row?.trailingFeeAprPct ?? null)}</b><small className="cell-note">Based on 24h fees</small></td>
                <td>{compactMoney(row?.volume24hUsd)}</td>
                <td>{compactMoney(row?.liquidityUsd)}</td>
                <td><span className="market-links">
                  {zappable ? <button className="market-link zap-link" type="button" aria-expanded={isOpen} onClick={() => onOpenZap(market.id)} aria-label={`Make the ${market.symbol}/WETH market`}><span className="market-link-label">{isOpen ? "Close" : "Make market"}</span></button> : null}
                  <a className="market-link gecko-link" href={row?.sourceUrl ?? geckoPoolUrl(market.pool)} target="_blank" rel="noreferrer" aria-label={`View ${market.symbol}/WETH on GeckoTerminal`}><img src={BRAND_ASSETS.gecko} alt="" /><span className="market-link-label">Gecko</span></a>
                  <a className="market-link fomo-link" href={FOMO_URL} target="_blank" rel="noreferrer" aria-label={`Trade ${market.symbol}/WETH on Fomo`}><img src={BRAND_ASSETS.fomo} alt="" /><span className="market-link-label">Trade on Fomo</span></a>
                </span></td>
              </tr>];
              if (isOpen) rows.push(<tr className="zap-row" key={`${market.id}-zap`}><td colSpan={5}>
                <ZapPanel
                  market={market as CuratedMarket}
                  feeAprPct={row?.trailingFeeAprPct ?? null}
                  amount={zapAmount}
                  plan={zapPlan}
                  state={zapState}
                  onAmount={onZapAmount}
                  onPrepare={() => onPrepareZap(market.id)}
                  onExecute={onExecuteZap}
                  onClose={onCloseZap}
                  balance={balance}
                  fundingState={fundingState}
                  onFund={onFund}
                />
              </td></tr>);
              return rows;
            }) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ZapPanel({ market, feeAprPct, amount, plan, state, onAmount, onPrepare, onExecute, onClose, balance, fundingState, onFund }: {
  market: CuratedMarket;
  feeAprPct: number | null;
  amount: string;
  plan: AllocationPlan | null;
  state: PlanState;
  onAmount: (next: string) => void;
  onPrepare: () => void;
  onExecute: () => void;
  onClose: () => void;
  balance: BalanceState | null;
  fundingState: PlanState;
  onFund: () => void;
}) {
  const planMarket = plan?.markets[0];
  const busy = state.kind === "signing" || state.kind === "waiting";
  return <div className="zap-panel" aria-label={`Make the ${market.symbol}/WETH market`}>
    <div className="zap-head">
      <span><b>Make the {market.symbol}/WETH market</b><small>One amount. Wizzy swaps, ranges, and mints your position in a single confirmation.</small></span>
      <span className="zap-range"><small>Range</small><b>±{market.rangeWidthPct.toFixed(0)}%</b></span>
      {feeAprPct !== null ? <span className="zap-range"><small>Fee APR</small><b>{formatFeeApr(feeAprPct)}</b></span> : null}
    </div>
    <div className="zap-controls">
      <label className="zap-amount">
        <input inputMode="decimal" value={amount} placeholder="0.00" onChange={(event) => onAmount(event.target.value)} aria-label="ETH amount" />
        <b>ETH</b>
      </label>
      {balance ? <span className="wallet-balance" role="status" title="Robinhood Chain ETH balance">Balance <b>{balance.kind === "ready" && balance.balanceWei !== undefined ? formatWalletBalance(balance.balanceWei) : "—"} ETH</b></span> : null}
      {plan && (state.kind === "ready" || busy) ? (
        <button className="fund-button zap-cta" type="button" disabled={busy} onClick={onExecute}>
          {busy ? state.message : `Mint ${market.symbol} position`}
        </button>
      ) : (
        <button className="fund-button zap-cta" type="button" disabled={state.kind === "planning"} onClick={onPrepare}>
          {state.kind === "planning" ? "Quoting…" : "Review"}
        </button>
      )}
      <button className="zap-close" type="button" onClick={onClose} aria-label="Close">Cancel</button>
    </div>
    {plan && planMarket ? <div className="zap-preview">
      <span><small>Position</small><b>{formatWalletBalance(planMarket.mintWeth)} WETH + {compactAmount(planMarket.mintMeme, 18)} {market.symbol}</b></span>
      <span><small>Service fee</small><b>{formatWalletBalance(plan.serviceFeeWei)} ETH</b></span>
      <span><small>Ticks</small><b>{planMarket.tickLower} → {planMarket.tickUpper}</b></span>
    </div> : null}
    <div className="funding-choice">
      <span><b>ETH on another chain?</b><small>Bridge to your Wizzy account.</small></span>
      <button className="cross-chain-fund" type="button" disabled={fundingState.kind === "planning"} onClick={onFund}>
        <EthereumIcon />{fundingState.kind === "planning" ? "Opening Privy…" : "Add ETH"}
      </button>
    </div>
    {fundingState.kind === "submitted" || fundingState.kind === "error" ? <p className={`funding-status is-${fundingState.kind}`} aria-live="polite">{fundingState.message}</p> : null}
    {state.kind === "submitted" || state.kind === "error" ? <p className={`funding-status is-${state.kind === "submitted" ? "submitted" : "error"}`} aria-live="polite">{state.message}</p> : null}
    <p className="action-assurance">Robinhood Chain · Self-custodial · The position NFT goes to your wallet</p>
  </div>;
}

function IndexSnapshot({ markets, stats, state }: { markets: IndexMarket[]; stats: Map<string, MarketStats>; state: "loading" | "ready" | "error" }) {
  const volume = markets.reduce((sum, { market }) => sum + (stats.get(market.id)?.volume24hUsd ?? 0), 0);
  const liquidity = markets.reduce((sum, { market }) => sum + (stats.get(market.id)?.liquidityUsd ?? 0), 0);
  const feeApr = weightedFeeApr(markets, stats);
  const compositionLabel = markets.map(({ market, indexWeightBps }) => `${market.symbol} ${(indexWeightBps / 100).toFixed(0)}%`).join(", ");
  return <section className={`index-snapshot is-${state}`} aria-label="Live index snapshot">
    <div className="index-snapshot-top">
      <span className="snapshot-origin"><img src={BRAND_ASSETS.robinhood} alt="" /><span><small>Live on</small><b>Robinhood Chain</b></span></span>
      <dl className="index-vitals">
        <div><dt>Fee APR</dt><dd>{formatFeeApr(feeApr)}</dd><small>Based on 24h fees</small></div>
        <div><dt>24h volume</dt><dd>{state === "ready" ? compactMoney(volume) : "—"}</dd><small>Across the index</small></div>
        <div><dt>Liquidity</dt><dd>{state === "ready" ? compactMoney(liquidity) : "—"}</dd><small>Across the index</small></div>
      </dl>
    </div>
    <div className="index-composition">
      <span className="composition-heading"><b>Index composition</b><small>Curator weights</small></span>
      <span className={`composition-track ${state === "loading" ? "is-loading" : ""}`} role="img" aria-label={compositionLabel || "Reading index composition"}>
        {state === "loading" ? Array.from({ length: INDEX_MARKET_COUNT }, (_, index) => <i key={index} />) : markets.map(({ market, indexWeightBps }, index) => <i className="composition-segment" key={market.id} style={{ "--market-color": market.color, "--market-index": index, "--market-weight": indexWeightBps } as CSSProperties} />)}
      </span>
      {state === "ready" ? <span className="composition-key">
        {markets.map(({ market, indexWeightBps }, index) => <span className="composition-item" key={market.id} style={{ "--market-index": index, "--market-weight": indexWeightBps } as CSSProperties}><TokenIcon symbol={market.symbol} src={stats.get(market.id)?.tokenImageUrl} color={market.color} /><span><b>{market.symbol}</b><small>{(indexWeightBps / 100).toFixed(0)}%</small></span></span>)}
      </span> : null}
    </div>
  </section>;
}

function PositionLedger({ authenticated, positions, state, markets, stats, onStart, onRetry, onAction, actionPlan, actionState, onExecute, onCancel, updates, migrationPlan, migrationState, onPrepareMigration, onExecuteMigration, onCancelMigration }: {
  authenticated: boolean;
  positions: PositionView[];
  state: "idle" | "loading" | "ready" | "error";
  markets: IndexMarket[];
  stats: Map<string, MarketStats>;
  onStart: () => void;
  onRetry: () => void;
  onAction: (position: PositionView, action: PositionActionKind) => void;
  actionPlan: AnyPositionActionPlan | null;
  actionState: PlanState;
  onExecute: () => void;
  onCancel: () => void;
  updates: AvailableIndexUpdate[];
  migrationPlan: IndexMigrationPlan | null;
  migrationState: PlanState;
  onPrepareMigration: (update: AvailableIndexUpdate) => void;
  onExecuteMigration: () => void;
  onCancelMigration: () => void;
}) {
  const summary = summarizePositions(positions);
  const summaryValueEth = positions.reduce((total, position) => total + (positionValueEth(position) ?? 0), 0);
  const summaryFeesEth = positions.reduce((total, position) => total + (positionFeesEth(position) ?? 0), 0);
  const showPositions = authenticated && positions.length > 0;
  const settlement = actionPlan && "settlement" in actionPlan ? actionPlan.settlement : undefined;
  return (
    <section className={`position-ledger ${authenticated ? "" : "is-disconnected"}`} id="positions">
      {updates.length ? <IndexUpdatePanel updates={updates} plan={migrationPlan} state={migrationState} onPrepare={onPrepareMigration} onExecute={onExecuteMigration} onCancel={onCancelMigration} /> : null}
      {actionState.kind !== "idle" ? (
        <section className={`action-preview is-${actionState.kind}`} aria-live="polite">
          {actionState.kind === "submitted" ? <SuccessCelebration label={actionPlan?.kind === "withdraw" ? "ETH returned" : actionPlan?.kind === "rebalance" ? "Position rebalanced" : "Fees compounded"} /> : null}
          <div className="action-copy"><b>{positionActionTitle(actionPlan, actionState)}</b><p>{positionActionDescription(actionPlan, actionState, settlement)}</p></div>
          {actionPlan && actionState.kind === "ready" ? <span>{formatServiceFee(actionPlan.serviceFeeBps)}</span> : null}
          <div className="action-buttons">{actionState.kind === "ready" ? <button className="small-primary" type="button" onClick={onExecute}>{actionPlan?.kind === "withdraw" ? "Withdraw to ETH" : actionPlan?.kind === "rebalance" ? "Rebalance" : "Compound"}</button> : null}<button type="button" onClick={onCancel} disabled={actionState.kind === "planning" || actionState.kind === "signing" || actionState.kind === "waiting"}>Close</button></div>
        </section>
      ) : null}
      {!authenticated ? <PortfolioEmpty variant="disconnected" onPrimary={onStart} /> : null}
      {authenticated && (state === "idle" || state === "loading") ? <PortfolioEmpty variant="loading" /> : null}
      {authenticated && state === "error" ? <PortfolioEmpty variant="error" onPrimary={onRetry} /> : null}
      {authenticated && state === "ready" && positions.length === 0 ? <PortfolioEmpty variant="empty" onPrimary={onStart} /> : null}
      {showPositions ? <section className="portfolio-summary" aria-label="Portfolio summary">
        <div><span>Position value</span><strong>{summary.valueUsd > 0 ? money(summary.valueUsd) : summaryValueEth > 0 ? ethValue(summaryValueEth) : "—"}</strong><small>{summary.valueUsd > 0 ? `${summary.priced} of ${positions.length} priced` : "From live token balances"}</small></div>
        <div><span>Ready to collect</span><strong>{summary.feesUsd > 0 ? money(summary.feesUsd) : ethValue(summaryFeesEth)}</strong><small>Unclaimed fees</small></div>
        <div><span>Earning now</span><strong>{summary.earning}</strong><small>of {positions.length} {positions.length === 1 ? "position" : "positions"} in range</small></div>
        <div><span>Fee APR</span><strong>{formatFeeAprFraction(summary.feeApr)}</strong><small>Across priced positions</small></div>
      </section> : null}
      {showPositions ? <div className="position-list">{positions.map((position) => <article key={`${position.chain}-${position.protocol}-${position.positionManager ?? "default"}-${position.tokenId}`}>
        <span className="position-pair"><TokenIcon symbol={position.symbol0} src={positionTokenImage(position, markets, stats)} /><span><b>{position.pair}</b><small>{position.chainLabel}{position.venueLabel ? ` · ${position.venueLabel}` : ""}</small></span></span>
        <span><small>Position value</small><b>{positionValueLabel(position)}</b></span>
        <span><small>Ready to collect</small><b>{positionFeesLabel(position)}</b></span>
        <span><small>Fee APR</small><b>{formatFeeAprFraction(position.feeApr ?? null)}</b></span>
        <PositionRange position={position} />
        <PositionActions position={position} onAction={onAction} />
      </article>)}</div> : null}
    </section>
  );
}

function PositionActions({ position, onAction }: {
  position: PositionView;
  onAction: (position: PositionView, action: PositionActionKind) => void;
}) {
  const needsRebalance = !position.inRange;
  const canRebalance = position.protocol === "V3" && position.chain !== "solana" && position.venue !== "aerodrome-slipstream";
  const primaryAction: PositionActionKind = needsRebalance ? "rebalance" : "compound";
  const primaryDisabled = position.closed || (needsRebalance && !canRebalance);
  return <span className="position-actions">
    <button type="button" onClick={() => onAction(position, primaryAction)} disabled={primaryDisabled} title={needsRebalance && !canRebalance ? "Rebalancing is not available for this pool yet" : undefined}>{needsRebalance ? "Rebalance" : "Compound"}</button>
    <button type="button" onClick={() => onAction(position, "withdraw")} disabled={position.closed}>{position.chain === "robinhood" ? "Withdraw to ETH" : "Withdraw"}</button>
  </span>;
}

function positionTokenImage(position: PositionView, markets: IndexMarket[], stats: Map<string, MarketStats>): string | null | undefined {
  if (position.marketId) {
    const direct = stats.get(position.marketId)?.tokenImageUrl;
    if (direct) return direct;
  }
  const market = markets.find(({ market }) =>
    (position.pool && "pool" in market && market.pool.toLowerCase() === position.pool.toLowerCase())
    || market.symbol.toLowerCase() === position.symbol0.toLowerCase(),
  )?.market;
  if (!market) return undefined;
  return stats.get(market.id)?.tokenImageUrl ?? ("imageUrl" in market ? market.imageUrl : undefined);
}

function positionActionTitle(plan: AnyPositionActionPlan | null, state: PlanState): string {
  if (!plan) return "Preparing your position";
  if (state.kind === "submitted") {
    if (plan.kind === "withdraw") return `${plan.pair} withdrawn to ETH`;
    if (plan.kind === "rebalance") return `${plan.pair} rebalanced`;
    return `${plan.pair} fees compounded`;
  }
  if (plan.kind === "withdraw") return `Withdraw ${plan.pair} to ETH`;
  if (plan.kind === "rebalance") return `Rebalance ${plan.pair}`;
  return `Compound ${plan.pair} fees`;
}

function positionActionDescription(
  plan: AnyPositionActionPlan | null,
  state: PlanState,
  settlement: PositionActionPlan["settlement"] | undefined,
): string {
  if (!plan || state.kind !== "ready") return state.message ?? "";
  if (plan.kind === "withdraw" && settlement?.asset === "ETH") {
    return `Close this position and return at least ${trimEth(BigInt(settlement.minimumAmountWei))} ETH to your wallet.`;
  }
  if (plan.kind === "withdraw") return "Close this position and return both pool tokens to your wallet.";
  if (plan.kind === "rebalance") return "Move this liquidity into a same-width range centred on the current price.";
  return "Collect and reinvest the fees ready to claim.";
}

function formatServiceFee(serviceFeeBps: number): string {
  return `${(serviceFeeBps / 100).toFixed(serviceFeeBps % 100 === 0 ? 0 : 2)}% Wizzy fee`;
}

function IndexUpdatePanel({ updates, plan, state, onPrepare, onExecute, onCancel }: {
  updates: AvailableIndexUpdate[];
  plan: IndexMigrationPlan | null;
  state: PlanState;
  onPrepare: (update: AvailableIndexUpdate) => void;
  onExecute: () => void;
  onCancel: () => void;
}) {
  const busy = state.kind === "planning" || state.kind === "signing";
  if (state.kind !== "idle") return <section className={`index-update-panel is-${state.kind}`} aria-live="polite">
    <header><span><b>{plan ? `${plan.fromMarket.symbol} → ${plan.toMarket.symbol}` : "Preparing index update"}</b><small>{state.message}</small></span><button type="button" onClick={onCancel} disabled={busy}>Close</button></header>
    {plan ? <dl>
      <div><dt>Position replaced</dt><dd>{plan.fromMarket.symbol} → {plan.toMarket.symbol}</dd></div>
      <div><dt>Amount moving</dt><dd>At least {trimEth(BigInt(plan.migratedAmountFloorWei))} ETH</dd></div>
      <div><dt>Wizzy rebalance fee</dt><dd>{trimEth(BigInt(plan.serviceFeeWei))} ETH</dd></div>
      <div><dt>Approval</dt><dd>One atomic wallet batch</dd></div>
    </dl> : null}
    {state.kind === "ready" ? <><p>If any step fails, your original position remains unchanged. Other index positions are untouched.</p><button className="small-primary" type="button" onClick={onExecute}>Update position</button></> : null}
    {state.kind === "error" ? <button className="secondary-button" type="button" onClick={onCancel}>Dismiss</button> : null}
  </section>;
  return <section className="index-update-panel" aria-label="Index update available">
    <div className="index-update-copy"><span className="update-mark"><RefreshIcon /></span><span><b>Index updated</b><small>{updates.length === 1 ? `${updates[0]!.fromSymbol} has been replaced by ${updates[0]!.toSymbol}.` : `${updates.length} positions can move to the latest index.`}</small></span></div>
    <div className="index-update-actions">
      {updates.map((update) => <button className="small-primary" type="button" key={`${update.migrationId}-${update.position.tokenId}`} onClick={() => onPrepare(update)}>Review {update.fromSymbol} update</button>)}
    </div>
  </section>;
}

function PortfolioEmpty({ variant, onPrimary }: {
  variant: "disconnected" | "loading" | "error" | "empty";
  onPrimary?: () => void;
}) {
  const content = variant === "disconnected"
    ? { title: "Reveal your markets", body: "Connect to see position value, fees, range status, and index updates.", action: "Connect wallet" }
    : variant === "error"
      ? { title: "We couldn’t load your positions.", body: "Try again to read your wallet.", action: "Try again" }
    : variant === "empty"
        ? { title: "Your markets will live here.", body: "Make markets once and Wizzy opens every index position your deposit supports.", action: "Make markets" }
        : { title: "Reading your positions.", body: "Your liquidity will appear here.", action: "" };
  return <section className={`portfolio-empty is-${variant}`} aria-live={variant === "loading" ? "polite" : undefined}>
    <span className="empty-symbol">{variant === "empty" ? <img src="/brand/wizzy-mascot-32.png" alt="" /> : <WalletIcon />}</span>
    <div className="empty-copy">
      <h3>{content.title}</h3>
      <p>{content.body}</p>
    </div>
    {onPrimary && content.action ? <button className="empty-action" type="button" onClick={onPrimary}>{content.action}</button> : null}
  </section>;
}

function PositionRange({ position }: { position: PositionView }) {
  const positionPct = position.closed
    ? 50
    : position.tickCurrent < position.tickLower
      ? 0
      : position.tickCurrent > position.tickUpper
        ? 100
        : Math.max(0, Math.min(100, position.percentThroughRange));
  const status = position.status === "in-range" ? "In range" : position.status === "oor" ? "Out of range" : "Closed";
  const description = `${status}. Current price ${priceLabel(position.price)}. Range ${priceLabel(position.priceMin)} to ${priceLabel(position.priceMax, position.priceMax === null)}.`;
  return <span className={`position-range-viz is-${position.status}`} style={{ "--range-position": `${positionPct}%` } as CSSProperties} role="img" aria-label={description}>
    <span className="range-heading"><small>Price range</small><b>{status}</b></span>
    <span className="range-track"><i /><b /></span>
    <span className="range-prices"><small>{priceLabel(position.priceMin)}</small><strong>{priceLabel(position.price)}</strong><small>{priceLabel(position.priceMax, position.priceMax === null)}</small></span>
  </span>;
}

function weightedFeeApr(markets: IndexMarket[], stats: Map<string, MarketStats>): number | null {
  const available = markets.filter(({ market }) => stats.get(market.id)?.trailingFeeAprPct != null);
  if (!available.length) return null;
  const weight = available.reduce((sum, row) => sum + row.indexWeightBps, 0);
  return available.reduce((sum, row) => sum + (stats.get(row.market.id)!.trailingFeeAprPct! * row.indexWeightBps) / weight, 0);
}

function marketTierIndex(policy: RobinhoodIndexBreadthPolicy, marketId: string): number {
  const index = policy.tiers.findIndex((tier) => tier.marketIds.includes(marketId));
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function chainLabel(chain: IndexChain): string {
  if (chain === "base") return "Base";
  if (chain === "robinhood") return "Robinhood";
  return "Solana";
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function positionValueLabel(position: PositionView): string {
  const usdValue = positionValueUsd(position);
  if (usdValue !== undefined && usdValue > 0) return money(usdValue);
  const eth = positionValueEth(position);
  return eth === undefined ? "—" : ethValue(eth);
}

function positionFeesLabel(position: PositionView): string {
  if (position.feesUsd !== undefined && position.feesUsd > 0) return money(position.feesUsd);
  const eth = positionFeesEth(position);
  return eth === undefined ? "—" : ethValue(eth);
}

function ethValue(value: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(value)} ETH`;
}

function compactMoney(value?: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatFeeApr(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(value >= 100 ? 0 : 1)}%`;
}

function formatFeeAprFraction(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatFeeApr(value * 100);
}

function trimEth(value: bigint): string {
  const formatted = formatEther(value);
  const [whole, fraction = ""] = formatted.split(".");
  return fraction ? `${whole}.${fraction.slice(0, 6).replace(/0+$/, "") || "0"}` : whole!;
}

function compactAmount(rawUnits: string, decimals: number): string {
  const value = Number(rawUnits) / 10 ** decimals;
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatWalletBalance(balanceWei: string): string {
  const value = Number(formatEther(BigInt(balanceWei)));
  if (value === 0) return "0";
  if (value < 0.0001) return "<0.0001";
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: value < 1 ? 4 : 3 }).format(value);
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function short(value: string): string {
  return value.startsWith("0x") && value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  if (preference === "light") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
  if (preference === "dark") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2.5" /><path d="M8 21h8M12 17v4M12 4v13" /></svg>;
}

function EthereumIcon() {
  return <svg className="ethereum-icon" viewBox="0 0 256 417" aria-hidden="true">
    <path d="M127.9 0 125 9.8v272l2.9 2.9 127.9-75.6Z" fill="currentColor" opacity=".72" />
    <path d="m127.9 0-128 209.1 128 75.6Z" fill="currentColor" />
    <path d="m127.9 309.2-1.6 2v98.2l1.6 4.7L256 233.6Z" fill="currentColor" opacity=".72" />
    <path d="M127.9 414.1V309.2L0 233.6Z" fill="currentColor" />
    <path d="m127.9 284.7 127.9-75.6-127.9-58.1Z" fill="currentColor" opacity=".45" />
    <path d="m0 209.1 127.9 75.6V151Z" fill="currentColor" opacity=".72" />
  </svg>;
}

function TokenIcon({ symbol, src, color }: { symbol: string; src?: string | null; color?: string }) {
  return <span className="token-icon" style={{ backgroundColor: color ?? "var(--surface-3)" }} aria-hidden="true">
    {src ? <img src={src} alt="" /> : <b>{symbol.slice(0, 1)}</b>}
  </span>;
}

function BrandLogo({ brand, label, compact = false }: { brand: keyof typeof BRAND_ASSETS; label: string; compact?: boolean }) {
  return <span className={`brand-logo is-${brand} ${compact ? "is-compact" : ""}`}>
    <img src={BRAND_ASSETS[brand]} alt="" aria-hidden="true" />
    {compact ? null : <span>{label}</span>}
  </span>;
}

function geckoPoolUrl(pool: string): string {
  return `https://www.geckoterminal.com/robinhood/pools/${pool.toLowerCase()}`;
}

function VenueTrail({ chain }: { chain: IndexChain }) {
  return <span className="venue-trail">
    <BrandLogo brand={chain} label={chainLabel(chain)} compact />
    <span>{chainLabel(chain)}</span>
  </span>;
}

function WalletIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3H6.5a1.5 1.5 0 0 0 0 3H20v8H6a2 2 0 0 1-2-2V7.5Z"/><circle cx="16.5" cy="15" r="1.25"/></svg>; }
function ChevronIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5" /></svg>; }
function ExternalLinkIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5" /></svg>; }
function SendIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-5 14-2.5-5.5L5 12Z" /><path d="m11.5 13.5 3-3" /></svg>; }
function DisconnectIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3M14 8l4 4-4 4M18 12H9" /></svg>; }
function RefreshIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 9a7 7 0 0 1 11.2-2L20 12M4 12l2.7 5a7 7 0 0 0 11.2-2" /></svg>; }
function CheckIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12.5 4 4 8-9" /></svg>; }
function XIcon() { return <svg className="x-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117Z" /></svg>; }
