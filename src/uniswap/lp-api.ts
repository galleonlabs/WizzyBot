import { CHAIN_ID } from "../constants.js";
import type { Address } from "viem";
import type { Protocol } from "../types.js";
import type { LpToken, TransactionRequest, UniswapHttp } from "./http.js";

/** Official LP API field names from developers.uniswap.org */

export type LpProtocol = Protocol;

export interface IndependentToken {
  tokenAddress: string;
  amount: string;
}

export interface ExistingPool {
  token0Address: string;
  token1Address: string;
  poolReference: string;
}

export interface TickBounds {
  tickLower: number;
  tickUpper: number;
}

export interface PriceBounds {
  minPrice: string;
  maxPrice: string;
}

export interface CreatePositionRequest {
  walletAddress: Address;
  protocol: "V3" | "V4";
  chainId: number;
  existingPool?: ExistingPool;
  newPool?: {
    token0Address: string;
    token1Address: string;
    fee: number;
    tickSpacing: number;
    hooks?: string;
    initialPrice?: string;
  };
  independentToken: IndependentToken;
  tickBounds?: TickBounds;
  priceBounds?: PriceBounds;
  simulateTransaction?: boolean;
}

export interface CreatePositionResponse {
  requestId: string;
  token0: LpToken;
  token1: LpToken;
  tickLower: number;
  tickUpper: number;
  adjustedMinPrice?: string;
  adjustedMaxPrice?: string;
  create: TransactionRequest;
  gasFee?: string;
}

export interface CreateClassicRequest {
  walletAddress: Address;
  poolParameters: {
    token0Address: string;
    token1Address: string;
    chainId: number;
  };
  independentToken: IndependentToken;
  dependentToken?: IndependentToken;
  simulateTransaction?: boolean;
}

export interface CreateClassicResponse {
  requestId: string;
  independentToken: LpToken;
  dependentToken: LpToken;
  create: TransactionRequest;
  gasFee?: string;
}

export interface IncreaseRequest {
  walletAddress: Address;
  chainId: number;
  protocol: LpProtocol;
  token0Address: Address;
  token1Address: Address;
  nftTokenId?: string;
  independentToken: IndependentToken;
  slippageTolerance?: number;
  simulateTransaction?: boolean;
}

export interface DecreaseRequest {
  walletAddress: Address;
  chainId: number;
  protocol: LpProtocol;
  token0Address: Address;
  token1Address: Address;
  nftTokenId?: string;
  liquidityPercentageToDecrease: number;
  withdrawAsWeth?: boolean;
  slippageTolerance?: number;
  simulateTransaction?: boolean;
}

export interface ClaimFeesRequest {
  protocol: LpProtocol;
  walletAddress: Address;
  chainId: number;
  tokenId: string;
  collectAsWeth?: boolean;
  simulateTransaction?: boolean;
}

export interface ClaimFeesResponse {
  requestId: string;
  token0: LpToken;
  token1: LpToken;
  claim: TransactionRequest;
  gasFee?: string;
}

export interface PoolInfoRequest {
  protocol: LpProtocol;
  chainId: number;
  token0Address: Address;
  token1Address: Address;
  fee?: number;
  poolReference?: string;
}

export interface CheckApprovalRequest {
  walletAddress: Address;
  protocol: LpProtocol;
  chainId: number;
  lpTokens: IndependentToken[];
  action: "CREATE" | "INCREASE" | "DECREASE" | "MIGRATE";
}

export class LpApi {
  constructor(private readonly http: UniswapHttp) {}

  create(body: CreatePositionRequest) {
    return this.http.lp<CreatePositionResponse>("/lp/create", {
      ...body,
      chainId: body.chainId ?? CHAIN_ID,
    });
  }

  /** Official v2 create. Fees are realized on decrease, not claim_fees. */
  createClassic(body: CreateClassicRequest) {
    return this.http.lp<CreateClassicResponse>("/lp/create_classic", body);
  }

  increase(body: IncreaseRequest) {
    return this.http.lp<{ increase: TransactionRequest; gasFee?: string }>("/lp/increase", {
      ...body,
      chainId: body.chainId ?? CHAIN_ID,
    });
  }

  decrease(body: DecreaseRequest) {
    return this.http.lp<{ decrease: TransactionRequest; gasFee?: string }>("/lp/decrease", {
      ...body,
      chainId: body.chainId ?? CHAIN_ID,
    });
  }

  claimFees(body: ClaimFeesRequest) {
    if (body.protocol === "V2") {
      throw new Error("v2 has no claim_fees; fees are embedded in the LP token — use decrease");
    }
    return this.http.lp<ClaimFeesResponse>("/lp/claim_fees", {
      ...body,
      chainId: body.chainId ?? CHAIN_ID,
    });
  }

  poolInfo(body: PoolInfoRequest) {
    return this.http.lp<unknown>("/lp/pool_info", {
      ...body,
      chainId: body.chainId ?? CHAIN_ID,
    });
  }

  checkApproval(body: CheckApprovalRequest) {
    return this.http.lp<{ transactions: { transaction: TransactionRequest }[] }>("/lp/check_approval", {
      ...body,
      chainId: body.chainId ?? CHAIN_ID,
    });
  }
}

export function txFromApi(tx: TransactionRequest | undefined, description: string): { to: Address; data: `0x${string}`; value: bigint; description: string } | undefined {
  if (!tx?.to || !tx.data || tx.data === "0x") return undefined;
  return {
    to: tx.to as Address,
    data: tx.data as `0x${string}`,
    value: BigInt(tx.value ?? "0"),
    description,
  };
}
