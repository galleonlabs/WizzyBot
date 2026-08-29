"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useEveAgent } from "eve/react";

type InputRequest = {
  requestId: string;
  kind?: string;
  prompt?: string;
  allowFreeform?: boolean;
  toolName?: string;
  options?: { id: string; label: string }[];
};

type ToolPart = {
  type: "dynamic-tool";
  state?: string;
  toolName?: string;
  output?: unknown;
  errorText?: string;
  input?: unknown;
  toolMetadata?: { eve?: { inputRequest?: InputRequest } };
};

type MessagePart = { type: string; text?: string } | ToolPart;

type ChatMessage = {
  id: string;
  role: string;
  parts: MessagePart[];
};

const STARTERS = [
  "List my positions",
  "Plan a compound",
  "Re-range if I'm out",
  "Exit a position",
];

export function Chat() {
  const { ready, authenticated, login, logout, user, getAccessToken } = usePrivy();
  const agent = useEveAgent({
    headers: async (): Promise<Record<string, string>> => {
      const token = await getAccessToken();
      return token ? { authorization: `Bearer ${token}` } : {};
    },
  });
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isResuming = agent.status === "resuming";
  const scroller = useRef<HTMLDivElement>(null);
  const messages = agent.data.messages as ChatMessage[];

  const pending = messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      if (!isTool(part) || part.state !== "approval-requested") return [];
      const request = part.toolMetadata?.eve?.inputRequest;
      return request ? [request] : [];
    }),
  );

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, agent.status, pending.length]);

  function send(text: string) {
    const message = text.trim();
    if (!message || isResuming) return;
    void agent.send(message, isBusy ? { turnPolicy: "steer" } : undefined);
  }

  const account = user?.email?.address ?? (user?.wallet?.address ? short(user.wallet.address) : null);

  return (
    <div className="chat">
      <header className="chat-bar">
        <Link className="wordmark" href="/">
          <i className="mark" aria-hidden="true" />
          UnaBot
        </Link>
        <div className="chat-bar-meta">
          <span>Base · dry-run default</span>
          {!ready ? (
            <span>…</span>
          ) : authenticated ? (
            <button className="ghost" type="button" onClick={() => void logout()}>
              {account ?? "Sign out"}
            </button>
          ) : (
            <button className="ghost" type="button" onClick={() => void login()}>
              Email login
            </button>
          )}
        </div>
      </header>

      <div className="thread" ref={scroller}>
        <div className="thread-inner">
          {messages.length === 0 ? (
            <div className="empty">
              <h2>Dry-run until you say yes.</h2>
              <p>List, compound, re-range, exit. Live writes wait for confirm.</p>
              <div className="chips">
                {STARTERS.map((item) => (
                  <button
                    key={item}
                    className="chip"
                    type="button"
                    disabled={isResuming}
                    onClick={() => {
                      if (!authenticated) {
                        void login();
                        return;
                      }
                      send(item);
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <article key={message.id} className={`msg msg-${message.role}`}>
                <header className="msg-role">{message.role === "user" ? "you" : "unabot"}</header>
                {message.parts.map((part, index) => (
                  <PartView key={index} part={part} />
                ))}
              </article>
            ))
          )}
          {agent.error ? <p className="err">{agent.error.message}</p> : null}
        </div>
      </div>

      <footer className="dock">
        <div className="dock-inner">
          {pending.map((request) => (
            <section className="confirm" key={request.requestId}>
              <h3>{request.kind === "tool-approval" ? "Confirm live write" : "Question"}</h3>
              <p>{request.prompt}</p>
              <div className="confirm-row">
                {request.options?.map((option, i) => (
                  <button
                    key={option.id}
                    className={i === 0 ? "btn btn-accent" : "btn"}
                    type="button"
                    onClick={() => void agent.respond([{ requestId: request.requestId, optionId: option.id }])}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>
          ))}
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const value = String(new FormData(form).get("message") ?? "");
              if (!authenticated) {
                void login();
                return;
              }
              if (value.trim()) {
                send(value);
                form.reset();
              }
            }}
          >
            <input
              name="message"
              autoComplete="off"
              disabled={isResuming || !authenticated}
              placeholder={
                authenticated ? "List my positions, status a tokenId, or plan a compound…" : "Sign in with email to chat"
              }
            />
            <button className="btn btn-accent" type="submit" disabled={isResuming || !authenticated}>
              Send
            </button>
          </form>
        </div>
      </footer>
    </div>
  );
}

function PartView({ part }: { part: MessagePart }) {
  if (part.type === "text" && part.text) {
    return <p>{part.text}</p>;
  }
  if (!isTool(part)) return null;
  if (part.state === "approval-requested" || part.state === "approval-responded") {
    return <p className="tool-line">{part.toolName ?? "write"} · waiting on confirm</p>;
  }
  if (part.state === "input-streaming" || part.state === "input-available") {
    return <p className="tool-line">{part.toolName ?? "tool"} · {part.state === "input-available" ? "running" : "planning"}</p>;
  }
  if (part.state === "output-error") {
    return <p className="err">{part.errorText || "Tool failed."}</p>;
  }
  if (part.state === "output-denied") {
    return <p className="tool-line">{part.toolName ?? "write"} · not confirmed</p>;
  }
  if (part.state === "output-available") {
    return <ReceiptView toolName={part.toolName} output={part.output} />;
  }
  return null;
}

function ReceiptView({ toolName, output }: { toolName?: string; output: unknown }) {
  const data = unwrap(output);
  const receipt = isRecord(data.receipt) ? data.receipt : looksLikeReceipt(data) ? data : null;
  const positions = Array.isArray(data.positions) ? data.positions : null;
  const card = typeof data.card === "string" ? data.card : null;
  const text = typeof data.text === "string" ? data.text : typeof output === "string" ? output : null;
  const note = typeof data.note === "string" ? data.note : null;

  if (receipt) {
    const dry = receipt.dryRun !== false;
    const skipped = Boolean(receipt.skipped);
    const actions = asArray(receipt.actions);
    const hashes = asArray(receipt.hashes).map(String);
    if (typeof receipt.hash === "string") hashes.push(receipt.hash);
    return (
      <section className="receipt">
        <div className="receipt-head">
          <span>{String(receipt.action ?? toolName ?? "receipt")}</span>
          <span className={skipped ? "badge-skip" : dry ? "badge-dry" : "badge-live"}>
            {skipped ? "skipped" : dry ? "dry-run" : "live"}
          </span>
        </div>
        <dl>
          {receipt.tokenId != null ? (
            <>
              <dt>token</dt>
              <dd>{String(receipt.tokenId)}</dd>
            </>
          ) : null}
          {typeof receipt.from === "string" ? (
            <>
              <dt>from</dt>
              <dd>{short(receipt.from)}</dd>
            </>
          ) : null}
          {typeof receipt.reason === "string" ? (
            <>
              <dt>reason</dt>
              <dd>{receipt.reason}</dd>
            </>
          ) : null}
          {hashes.length > 0 ? (
            <>
              <dt>tx</dt>
              <dd>{hashes.map(short).join(" ")}</dd>
            </>
          ) : null}
        </dl>
        {actions.length > 0 ? (
          <ol>
            {actions.map((item, i) => {
              const row = asRecord(item) ?? {};
              return (
                <li key={i}>
                  {typeof row.kind === "string" ? <b>{row.kind} </b> : null}
                  {typeof row.description === "string" ? row.description : JSON.stringify(item)}
                </li>
              );
            })}
          </ol>
        ) : text ? (
          <pre>{text}</pre>
        ) : null}
        {note ? <p className="tool-line">{note}</p> : null}
      </section>
    );
  }

  if (positions) {
    return (
      <section className="receipt">
        <div className="receipt-head">
          <span>positions</span>
          <span className="badge-dry">{positions.length}</span>
        </div>
        <div className="pos-list">
          {positions.map((item, i) => {
            const row = asRecord(item) ?? {};
            return (
              <div className="pos" key={String(row.tokenId ?? i)}>
                <span>
                  <b>{String(row.pair ?? row.tokenId ?? "position")}</b>
                  {row.protocol != null ? ` · ${String(row.protocol)}` : ""}
                  {row.tokenId != null ? ` · ${String(row.tokenId)}` : ""}
                </span>
                <span className={row.inRange === false ? "out" : "in"}>
                  {row.inRange === false ? "out" : row.inRange === true ? "in range" : ""}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  if (card || text) {
    return (
      <section className="receipt">
        <div className="receipt-head">
          <span>{toolName ?? "result"}</span>
          <span className="badge-dry">read</span>
        </div>
        <pre className="card-pre">{card ?? text}</pre>
        {note ? <p className="tool-line">{note}</p> : null}
      </section>
    );
  }

  if (data && Object.keys(data).length > 0) {
    return (
      <section className="receipt">
        <div className="receipt-head">
          <span>{toolName ?? "result"}</span>
          <span className="badge-dry">result</span>
        </div>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </section>
    );
  }

  return <p className="tool-line">{toolName ?? "tool"} · done</p>;
}

function isTool(part: MessagePart): part is ToolPart {
  return part.type === "dynamic-tool";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function unwrap(output: unknown): Record<string, unknown> {
  if (typeof output === "string") {
    try {
      const parsed: unknown = JSON.parse(output);
      if (isRecord(parsed)) return unwrap(parsed);
    } catch {
      return {};
    }
  }
  if (!isRecord(output)) return {};
  if (isRecord(output.result)) return unwrap(output.result);
  if (isRecord(output.value) && ("receipt" in output.value || "positions" in output.value || "card" in output.value)) {
    return output.value;
  }
  return output;
}

function looksLikeReceipt(value: Record<string, unknown>): boolean {
  return "dryRun" in value || "actions" in value || "treasuryFee" in value;
}

function short(value: string): string {
  if (value.length <= 12) return value;
  if (value.startsWith("0x")) return `${value.slice(0, 6)}…${value.slice(-4)}`;
  return value;
}
