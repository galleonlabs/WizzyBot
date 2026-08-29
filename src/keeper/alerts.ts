import type { AlertEvent, AlertSink, SkipReason } from "../types.js";

const HEX_PRIVKEY = /0x[0-9a-fA-F]{64}/g;
const SECRET_FIELD = /private[_-]?key|api[_-]?key|app[_-]?secret|secret|authorization|telegram[_-]?bot[_-]?token|webhook/i;

export const LOG_FIELDS = ["ts", "level", "kind", "message"] as const;

export function redactString(value: string): string {
  return value.replace(HEX_PRIVKEY, "<redacted>");
}

export function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_FIELD.test(key) ? "<redacted>" : redactSecrets(nested);
    }
    return out;
  }
  return value;
}

export interface KeeperLog {
  ts: string;
  level: AlertEvent["level"];
  kind: string;
  message: string;
  tokenId?: string;
  action?: string;
  skipped?: boolean;
  skipReason?: SkipReason;
  dryRun?: boolean;
}

export function formatLog(event: AlertEvent): KeeperLog {
  const clean = redactSecrets(event) as AlertEvent;
  const log: KeeperLog = {
    ts: clean.at,
    level: clean.level,
    kind: clean.kind,
    message: redactString(clean.message),
  };
  if (clean.tokenId) log.tokenId = clean.tokenId;
  if (clean.action) log.action = clean.action;
  if (clean.skipped !== undefined) log.skipped = clean.skipped;
  if (clean.skipReason) log.skipReason = clean.skipReason;
  if (clean.dryRun !== undefined) log.dryRun = clean.dryRun;
  return log;
}

export class StdoutSink implements AlertSink {
  constructor(private readonly write?: (line: string, level: AlertEvent["level"]) => void) {}

  emit(event: AlertEvent): void {
    const line = JSON.stringify(formatLog(event));
    if (this.write) {
      this.write(line, event.level);
      return;
    }
    if (event.level === "error") console.error(line);
    else console.log(line);
  }
}

export class WebhookSink implements AlertSink {
  constructor(
    private readonly url: string,
    private readonly post: typeof fetch = fetch,
  ) {}

  async emit(event: AlertEvent): Promise<void> {
    const body = JSON.stringify(formatLog(event));
    try {
      await this.post(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
    } catch (err) {
      const message = redactString(String(err instanceof Error ? err.message : err)).replaceAll(
        this.url,
        "<redacted>",
      );
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", kind: "alert_webhook", message }));
    }
  }
}

export class MultiplexSink implements AlertSink {
  constructor(private readonly sinks: AlertSink[]) {}
  async emit(event: AlertEvent): Promise<void> {
    for (const sink of this.sinks) {
      await sink.emit(event);
    }
  }
}

export function createAlertSink(opts: { webhookUrl?: string; fetch?: typeof fetch; write?: StdoutSink["write"] } = {}): AlertSink {
  const stdout = new StdoutSink(opts.write);
  const webhookUrl = opts.webhookUrl ?? process.env.UNABOT_ALERT_WEBHOOK;
  if (!webhookUrl) return stdout;
  return new MultiplexSink([stdout, new WebhookSink(webhookUrl, opts.fetch ?? fetch)]);
}

export function alert(
  sink: AlertSink,
  level: AlertEvent["level"],
  kind: string,
  message: string,
  tokenId?: string,
  extra: Partial<Pick<AlertEvent, "action" | "skipped" | "skipReason" | "dryRun">> = {},
): void {
  void sink.emit({
    level,
    kind,
    message: redactString(message),
    tokenId,
    at: new Date().toISOString(),
    ...extra,
  });
}
