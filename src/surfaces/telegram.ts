import { parseIntent, confirmPhrase, isWrite, type Intent } from "../agent/nlp.js";

export const TELEGRAM_TOKEN_HELP =
  "TELEGRAM_BOT_TOKEN is not set. Create a bot with @BotFather, export TELEGRAM_BOT_TOKEN (never commit it), then re-run: unabot telegram";

export function telegramBootMessage(token: string | undefined): string {
  if (!token) {
    return [
      "UnaBot telegram surface started (no token).",
      TELEGRAM_TOKEN_HELP,
      "Dry-run is the default. Live writes still require an explicit yes.",
    ].join("\n");
  }
  return "UnaBot. Uniswap LP on autopilot. Dry-run unless --live. Live writes require yes.";
}

export function telegramRequiresConfirm(text: string, live: boolean): boolean {
  return live && isWrite(parseIntent(text));
}

export interface TelegramReply {
  text: string;
  awaitConfirm: boolean;
}

export function planTelegramReply(text: string, live: boolean): TelegramReply {
  const trimmed = text.trim();
  if (!trimmed || /^(help|\/help|\/start)$/i.test(trimmed)) {
    return {
      text: [
        "UnaBot. Uniswap LP on autopilot.",
        "v2, v3, and v4. You keep the position.",
        "Compound, re-range, exit. Dry-run default. Type yes for live.",
        "list | status 12345 | mint WETH/USDC 0.05% width 10",
      ].join("\n"),
      awaitConfirm: false,
    };
  }
  const intent = parseIntent(trimmed);
  if (intent.verb === "unknown") {
    return { text: `Could not parse: ${intent.text}`, awaitConfirm: false };
  }
  if (live && isWrite(intent)) {
    return { text: confirmPhrase(intent), awaitConfirm: true };
  }
  return { text: formatIntentPreview(intent, live), awaitConfirm: false };
}

export function formatIntentPreview(intent: Intent, live: boolean): string {
  const dry = live ? "live" : "dry-run";
  switch (intent.verb) {
    case "help":
      return planTelegramReply("help", live).text;
    case "list":
      return `${dry} list${intent.owner ? ` owner=${intent.owner}` : ""}`;
    case "status":
      return intent.tokenId === undefined ? `${dry} list` : `${dry} status tokenId=${intent.tokenId}`;
    case "mint":
      return `${dry} mint ${intent.token0 ?? "?"}/${intent.token1 ?? "?"} fee=${intent.fee ?? "?"} width=${intent.widthPct ?? "?"}`;
    case "compound":
      return `${dry} compound tokenId=${intent.tokenId}`;
    case "rerange":
      return `${dry} range tokenId=${intent.tokenId}`;
    case "exit":
      return `${dry} exit tokenId=${intent.tokenId}`;
    default:
      return `${dry} ${intent.verb}`;
  }
}

export interface TelegramApi {
  getUpdates(offset: number): Promise<TelegramUpdate[]>;
  sendMessage(chatId: number, text: string): Promise<void>;
}

export interface TelegramUpdate {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
}

export function createTelegramApi(token: string, fetchImpl: typeof fetch = fetch): TelegramApi {
  const base = `https://api.telegram.org/bot${token}`;
  return {
    async getUpdates(offset: number) {
      const res = await fetchImpl(`${base}/getUpdates?timeout=20&offset=${offset}`);
      if (!res.ok) throw new Error(`telegram getUpdates ${res.status}`);
      const json = (await res.json()) as { ok: boolean; result: TelegramUpdate[] };
      return json.result ?? [];
    },
    async sendMessage(chatId: number, text: string) {
      await fetchImpl(`${base}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
    },
  };
}

export async function runTelegramLoop(args: {
  token: string | undefined;
  live: boolean;
  api?: TelegramApi;
  execute?: (text: string) => Promise<string>;
  signal?: AbortSignal;
  log?: (line: string) => void;
}): Promise<void> {
  const log = args.log ?? console.log;
  log(telegramBootMessage(args.token));
  if (!args.token) return;

  const api = args.api ?? createTelegramApi(args.token);
  const pending = new Map<number, string>();
  let offset = 0;

  while (!args.signal?.aborted) {
    let updates: TelegramUpdate[] = [];
    try {
      updates = await api.getUpdates(offset);
    } catch (err) {
      log(err instanceof Error ? err.message : String(err));
      continue;
    }
    for (const upd of updates) {
      offset = upd.update_id + 1;
      const chatId = upd.message?.chat.id;
      const text = upd.message?.text?.trim();
      if (chatId === undefined || !text) continue;

      const waiting = pending.get(chatId);
      if (waiting) {
        pending.delete(chatId);
        if (text.toLowerCase() !== "yes") {
          await api.sendMessage(chatId, "cancelled");
          continue;
        }
        const out = args.execute ? await args.execute(waiting) : formatIntentPreview(parseIntent(waiting), args.live);
        await api.sendMessage(chatId, out);
        continue;
      }

      const reply = planTelegramReply(text, args.live);
      if (reply.awaitConfirm) {
        pending.set(chatId, text);
        await api.sendMessage(chatId, reply.text);
        continue;
      }
      const out = args.execute ? await args.execute(text) : reply.text;
      await api.sendMessage(chatId, out);
    }
  }
}
