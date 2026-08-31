import { getAddress } from "viem";
import { z } from "zod";
import rawCatalog from "../config/stable-vaults.json" with { type: "json" };

const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform((value) => getAddress(value));

const VaultSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(64),
  symbol: z.string().min(1).max(24),
  venue: z.string().min(1).max(32),
  curatorName: z.string().min(1).max(64),
  vault: AddressSchema,
  weightBps: z.number().int().positive().max(10_000),
  status: z.enum(["active", "paused", "watch"]),
  risk: z.enum(["established", "emerging", "experimental"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  imageUrl: z.string().url().optional(),
});

const StableCatalogSchema = z.object({
  version: z.number().int().positive(),
  updatedAt: z.string().date(),
  chain: z.literal("base"),
  asset: z.object({
    address: AddressSchema,
    symbol: z.string().min(1),
    decimals: z.number().int().min(0).max(18),
  }),
  fees: z.object({
    allocateBps: z.number().int().min(0).max(10_000),
    withdrawBps: z.number().int().min(0).max(10_000),
  }),
  minimumDepositUnits: z.string().regex(/^\d+$/),
  vaults: z.array(VaultSchema).min(1).max(16),
}).superRefine((catalog, ctx) => {
  const ids = new Set<string>();
  const addresses = new Set<string>();
  for (const vault of catalog.vaults) {
    if (ids.has(vault.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["vaults"], message: `duplicate vault id ${vault.id}` });
    ids.add(vault.id);
    if (addresses.has(vault.vault.toLowerCase())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["vaults"], message: `duplicate vault address ${vault.vault}` });
    }
    addresses.add(vault.vault.toLowerCase());
  }
  const activeWeight = catalog.vaults
    .filter((vault) => vault.status === "active")
    .reduce((sum, vault) => sum + vault.weightBps, 0);
  if (activeWeight !== 10_000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["vaults"], message: "active vault weights must sum to 10,000 bps" });
  }
});

export type StableVault = z.infer<typeof VaultSchema>;
export type StableCatalog = z.infer<typeof StableCatalogSchema>;

export function parseStableCatalog(input: unknown): StableCatalog {
  return StableCatalogSchema.parse(input);
}

let cached: StableCatalog | null = null;

export function getStableCatalog(): StableCatalog {
  cached ??= parseStableCatalog(rawCatalog);
  return cached;
}

export function activeStableVaults(catalog: StableCatalog = getStableCatalog()): StableVault[] {
  return catalog.vaults.filter((vault) => vault.status === "active");
}
