import { CHAIN_ID } from "../constants.js";
import type { Address } from "viem";
import type { TransactionRequest, UniswapHttp } from "./http.js";

/** Uniswap API (legacy name: Trading API) official fields. */

export interface QuoteRequest {
  tokenIn: Address;
  tokenOut: Address;
  tokenInChainId: number;
  tokenOutChainId: number;
  amount: string;
  type: "EXACT_INPUT" | "EXACT_OUTPUT";
  protocols?: Array<"V2" | "V3" | "V4">;
  swapper?: Address;
}

export interface SwapRequest {
  tokenIn: Address;
  tokenOut: Address;
  tokenInChainId: number;
  tokenOutChainId: number;
  amount: string;
  type: "EXACT_INPUT" | "EXACT_OUTPUT";
  recipient: Address;
  slippageTolerance?: number;
  protocols?: Array<"V3">;
}

export class TradeApi {
  constructor(private readonly http: UniswapHttp) {}

  quote(body: QuoteRequest) {
    return this.http.trade<unknown>("/quote", {
      ...body,
      tokenInChainId: body.tokenInChainId ?? CHAIN_ID,
      tokenOutChainId: body.tokenOutChainId ?? CHAIN_ID,
      protocols: body.protocols ?? ["V3"],
    });
  }

  swap(body: SwapRequest) {
    return this.http.trade<{ swap?: TransactionRequest; transaction?: TransactionRequest }>("/swap", {
      ...body,
      tokenInChainId: body.tokenInChainId ?? CHAIN_ID,
      tokenOutChainId: body.tokenOutChainId ?? CHAIN_ID,
      protocols: body.protocols ?? ["V3"],
    });
  }
}
