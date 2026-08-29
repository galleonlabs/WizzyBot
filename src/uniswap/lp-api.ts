import { CHAIN_ID } from "../constants.js";
import type { Address } from "viem";
import type { LpToken, TransactionRequest, UniswapHttp } from "./http.js";

/** Official LP API field names from developers.uniswap.org */

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
  protocol: "V3";
  chainId: number;
  existingPool: ExistingPool;
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

export interface IncreaseRequest {
  walletAddress: Address;
  chainId: number;
  protocol: "V3";
  token0Address: Address;
  token1Address: Address;
  nftTokenId: string;
  independentToken: IndependentToken;
  slippageTolerance?: number;
  simulateTransaction?: boolean;
}

export interface DecreaseRequest {
  walletAddress: Address;
  chainId: number;
  protocol: "V3";
  token0Address: Address;
  token1Address: Address;
  nftTokenId: string;
  liquidityPercentageToDecrease: number;
  withdrawAsWeth?: boolean;
  slippageTolerance?: number;
  simulateTransaction?: boolean;
}

export interface ClaimFeesRequest {
  protocol: "V3";
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
  protocol: "V3";
  chainId: number;
  token0Address: Address;
  token1Address: Address;
  fee?: number;
  poolReference?: string;
}

export interface CheckApprovalRequest {
  walletAddress: Address;
  protocol: "V3";
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
      protocol: "V3",
    });
  }

  increase(body: IncreaseRequest) {
    return this.http.lp<{ increase: TransactionRequest; gasFee?: string }>("/lp/increase", body);
  }

  decrease(body: DecreaseRequest) {
    return this.http.lp<{ decrease: TransactionRequest; gasFee?: string }>("/lp/decrease", body);
  }

  claimFees(body: ClaimFeesRequest) {
    return this.http.lp<ClaimFeesResponse>("/lp/claim_fees", body);
  }

  poolInfo(body: PoolInfoRequest) {
    return this.http.lp<unknown>("/lp/pool_info", body);
  }

  checkApproval(body: CheckApprovalRequest) {
    return this.http.lp<{ transactions: { transaction: TransactionRequest }[] }>("/lp/check_approval", body);
  }
}
