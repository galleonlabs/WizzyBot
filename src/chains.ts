import { defineChain, getAddress, type Address, type Chain } from "viem";
import { base } from "viem/chains";
import { ADDRESSES, BASE_RPC_DEFAULT, CHAIN_ID, SIGNER_ALLOWLIST, TREASURY } from "./constants.js";

export type ChainSlug = "base" | "robinhood";

export type ChainAddresses = {
  factory: Address;
  nfpm: Address;
  swapRouter02: Address;
  quoterV2: Address;
  permit2: Address;
  universalRouter: Address;
  weth: Address;
  nativeEth: Address;
  v2Factory: Address;
  v2Router: Address;
  v4PoolManager: Address;
  v4PositionManager: Address;
  v4StateView: Address;
  v4Quoter: Address;
  usdc?: Address;
  usdBc?: Address;
  usdg?: Address;
};

export type UnaChain = {
  slug: ChainSlug;
  id: number;
  label: string;
  rpcDefault: string;
  explorer: string;
  addresses: ChainAddresses;
  allowlist: readonly Address[];
  viem: Chain;
};

export const ROBINHOOD_RPC_DEFAULT = "https://rpc.mainnet.chain.robinhood.com";

export const robinhoodViem = defineChain({
  id: 4663,
  name: "Robinhood",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD_RPC_DEFAULT] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

const ROBINHOOD_ADDRESSES: ChainAddresses = {
  factory: getAddress("0x1f7d7550b1b028f7571e69a784071f0205fd2efa"),
  nfpm: getAddress("0x73991a25c818bf1f1128deaab1492d45638de0d3"),
  swapRouter02: getAddress("0xcaf681a66d020601342297493863e78c959e5cb2"),
  quoterV2: getAddress("0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7"),
  permit2: getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3"),
  universalRouter: getAddress("0x8876789976decbfcbbbe364623c63652db8c0904"),
  weth: getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"),
  nativeEth: getAddress("0x0000000000000000000000000000000000000000"),
  v2Factory: getAddress("0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f"),
  v2Router: getAddress("0x89e5db8b5aa49aa85ac63f691524311aeb649eba"),
  v4PoolManager: getAddress("0x8366a39cc670b4001a1121b8f6a443a643e40951"),
  v4PositionManager: getAddress("0x58daec3116aae6d93017baaea7749052e8a04fa7"),
  v4StateView: getAddress("0xf3334192d15450cdd385c8b70e03f9a6bd9e673b"),
  v4Quoter: getAddress("0x8dc178efb8111bb0973dd9d722ebeff267c98f94"),
  usdg: getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"),
};

const ROBINHOOD_ALLOWLIST: readonly Address[] = [
  ROBINHOOD_ADDRESSES.nfpm,
  ROBINHOOD_ADDRESSES.swapRouter02,
  ROBINHOOD_ADDRESSES.permit2,
  ROBINHOOD_ADDRESSES.universalRouter,
  ROBINHOOD_ADDRESSES.v2Router,
  ROBINHOOD_ADDRESSES.v4PositionManager,
  TREASURY,
];

export const CHAINS: Record<ChainSlug, UnaChain> = {
  base: {
    slug: "base",
    id: CHAIN_ID,
    label: "Base",
    rpcDefault: BASE_RPC_DEFAULT,
    explorer: "https://basescan.org",
    addresses: { ...ADDRESSES },
    allowlist: SIGNER_ALLOWLIST,
    viem: base,
  },
  robinhood: {
    slug: "robinhood",
    id: 4663,
    label: "Robinhood",
    rpcDefault: ROBINHOOD_RPC_DEFAULT,
    explorer: "https://robinhoodchain.blockscout.com",
    addresses: ROBINHOOD_ADDRESSES,
    allowlist: ROBINHOOD_ALLOWLIST,
    viem: robinhoodViem,
  },
};

export const CHAIN_SLUGS: readonly ChainSlug[] = ["base", "robinhood"];

export function parseChainSlug(input?: string | null): ChainSlug {
  const v = (input ?? "base").trim().toLowerCase();
  if (!v || v === "base" || v === "8453") return "base";
  if (v === "robinhood" || v === "rh" || v === "4663") return "robinhood";
  throw new Error("Unknown chain. Use base|robinhood.");
}

export function chainOf(slug: ChainSlug = "base"): UnaChain {
  return CHAINS[slug];
}

export function chainById(id: number): UnaChain {
  if (id === 4663) return CHAINS.robinhood;
  if (id === CHAIN_ID) return CHAINS.base;
  throw new Error("Unsupported chainId. Use Base (8453) or Robinhood (4663).");
}

export function slugForChainId(id: number): ChainSlug {
  return id === 4663 ? "robinhood" : "base";
}

export function labelForChainId(id: number): string {
  return id === 4663 ? "Robinhood" : "Base";
}

export function addressesFor(slug: ChainSlug = "base"): ChainAddresses {
  return chainOf(slug).addresses;
}

export function signerAllowlistFor(slug: ChainSlug = "base"): readonly Address[] {
  return chainOf(slug).allowlist;
}

export function viemChainFor(slug: ChainSlug = "base"): Chain {
  return chainOf(slug).viem;
}

export function chainIdOfClient(client: { chain?: { id?: number } } | undefined): number {
  return client?.chain?.id ?? CHAIN_ID;
}

export function slugOfClient(client: { chain?: { id?: number } } | undefined): ChainSlug {
  return slugForChainId(chainIdOfClient(client));
}
