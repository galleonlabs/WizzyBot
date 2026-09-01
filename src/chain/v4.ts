import { encodeAbiParameters, getAddress, keccak256, padHex, toHex, type Address, type Hex, type PublicClient } from "viem";
import { ADDRESSES } from "../constants.js";
import { addressesFor, slugOfClient } from "../chains.js";
import { v4StateViewAbi, type V4PoolKey } from "./abi.js";
import { tickSpacingForFee } from "../core/ticks.js";

export function v4PoolId(key: V4PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "currency0", type: "address" },
            { name: "currency1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickSpacing", type: "int24" },
            { name: "hooks", type: "address" },
          ],
        },
      ],
      [{
        currency0: getAddress(key.currency0),
        currency1: getAddress(key.currency1),
        fee: key.fee,
        tickSpacing: key.tickSpacing,
        hooks: getAddress(key.hooks),
      }],
    ),
  );
}

export function assertUnhooked(hooks: Address): void {
  if (hooks.toLowerCase() !== ADDRESSES.nativeEth.toLowerCase()) {
    throw new Error(`Refuse unknown v4 hooks ${hooks}`);
  }
}

export function signExtend24(bits: bigint): number {
  const u = Number(bits & 0xffffffn);
  return u >= 0x800000 ? u - 0x1000000 : u;
}

export function decodePositionInfo(info: bigint): { tickLower: number; tickUpper: number } {
  return {
    tickLower: signExtend24(info >> 8n),
    tickUpper: signExtend24(info >> 32n),
  };
}

export function tokenIdSalt(tokenId: bigint): Hex {
  return padHex(toHex(tokenId), { size: 32 });
}

export async function loadV4Pool(
  client: PublicClient,
  tokenA: Address,
  tokenB: Address,
  fee: number,
  hooks: Address = ADDRESSES.nativeEth,
): Promise<{ poolId: Hex; key: V4PoolKey; sqrtPriceX96: bigint; tick: number; liquidity: bigint }> {
  assertUnhooked(hooks);
  const [c0, c1] =
    tokenA.toLowerCase() < tokenB.toLowerCase()
      ? [getAddress(tokenA), getAddress(tokenB)]
      : [getAddress(tokenB), getAddress(tokenA)];
  const key: V4PoolKey = {
    currency0: c0,
    currency1: c1,
    fee,
    tickSpacing: tickSpacingForFee(fee),
    hooks: getAddress(hooks),
  };
  const poolId = v4PoolId(key);
  const [slot0, liquidity] = await Promise.all([
    client.readContract({
      address: addressesFor(slugOfClient(client)).v4StateView,
      abi: v4StateViewAbi,
      functionName: "getSlot0",
      args: [poolId],
    }),
    client.readContract({
      address: addressesFor(slugOfClient(client)).v4StateView,
      abi: v4StateViewAbi,
      functionName: "getLiquidity",
      args: [poolId],
    }),
  ]);
  if (slot0[0] === 0n) {
    throw new Error(`no v4 pool for ${c0}/${c1} fee=${fee} hooks=${hooks} on ${slugOfClient(client)}`);
  }
  return { poolId, key, sqrtPriceX96: slot0[0], tick: slot0[1], liquidity };
}
