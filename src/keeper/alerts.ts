import type { AlertEvent, AlertSink } from "../types.js";

export class StdoutSink implements AlertSink {
  emit(event: AlertEvent): void {
    const line = `[${event.at}] ${event.level.toUpperCase()} ${event.kind}${event.tokenId ? ` tokenId=${event.tokenId}` : ""} ${event.message}`;
    if (event.level === "error") {
      console.error(line);
    } else {
      console.log(line);
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

export function alert(
  sink: AlertSink,
  level: AlertEvent["level"],
  kind: string,
  message: string,
  tokenId?: string,
): void {
  void sink.emit({
    level,
    kind,
    message,
    tokenId,
    at: new Date().toISOString(),
  });
}
