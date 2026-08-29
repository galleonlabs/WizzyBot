import { LP_API_URL, TRADE_API_URL } from "../constants.js";

export interface UniswapHttp {
  lp<T>(path: string, body: unknown): Promise<T>;
  trade<T>(path: string, body: unknown, method?: "GET" | "POST"): Promise<T>;
}

export function createUniswapHttp(apiKey: string): UniswapHttp {
  const headers = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  async function post<T>(url: string, body: unknown, method: "GET" | "POST" = "POST"): Promise<T> {
    const res = await fetch(url, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Uniswap API ${res.status} ${url}: ${text}`);
    }
    return (await res.json()) as T;
  }

  return {
    lp: (path, body) => post(`${LP_API_URL}${path}`, body),
    trade: (path, body, method = "POST") => post(`${TRADE_API_URL}${path}`, body, method),
  };
}

export interface TransactionRequest {
  to: string;
  from?: string;
  data: string;
  value?: string;
  chainId?: number;
  gasLimit?: string;
}

export interface LpToken {
  tokenAddress: string;
  amount: string;
}
