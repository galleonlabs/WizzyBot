"use client";

import { useEffect, useRef } from "react";
import { useEveAgent } from "eve/react";
import { usePrivy } from "@privy-io/react-auth";
import { ConfirmCard } from "./confirm-card";
import { isConfirmView, isRecord, type ConfirmView } from "./lib/cards";
import { unwrapToolOutput } from "./lib/panel";

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

const STARTERS = ["Show my unclaimed fees", "Why did my earnings change?", "What can make me lose money?", "Prepare a withdrawal"];

const WRITE_TOOLS = new Set(["mint", "compound", "range", "exit"]);

export function Chat({
  authenticated,
  onLogin,
  onToolOutput,
  lastConfirm,
}: {
  authenticated: boolean;
  onLogin: () => void;
  onToolOutput?: (toolName: string | undefined, output: unknown) => void;
  lastConfirm?: ConfirmView;
}) {
  const { getAccessToken } = usePrivy();
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
  const seen = useRef<Set<string>>(new Set());

  const pending = messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      if (!isTool(part) || part.state !== "approval-requested") return [];
      const request = part.toolMetadata?.eve?.inputRequest;
      return request ? [{ request, toolName: part.toolName, input: part.input }] : [];
    }),
  );

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, agent.status, pending.length]);

  useEffect(() => {
    if (!onToolOutput) return;
    for (const message of messages) {
      for (const [index, part] of message.parts.entries()) {
        if (!isTool(part) || part.state !== "output-available") continue;
        const key = `${message.id}:${index}:${part.toolName}`;
        if (seen.current.has(key)) continue;
        seen.current.add(key);
        onToolOutput(part.toolName, part.output);
      }
    }
  }, [messages, onToolOutput]);

  function send(text: string) {
    const message = text.trim();
    if (!message || isResuming) return;
    void agent.send(message, isBusy ? { turnPolicy: "steer" } : undefined);
  }

  return (
    <section className="chat cockpit-chat">
      <div className="thread" ref={scroller}>
        <div className="thread-inner">
          {messages.length === 0 ? (
            <div className="empty">
              <h2>What do you want to know?</h2>
              <p>Ask about a market, your fees, or a withdrawal.</p>
              <div className="chips">
                {STARTERS.map((item) => (
                  <button
                    key={item}
                    className="chip"
                    type="button"
                    disabled={isResuming}
                    onClick={() => {
                      if (!authenticated) {
                        onLogin();
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
                <header className="msg-role">{message.role === "user" ? "you" : "Una"}</header>
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
          {pending.map(({ request }) => (
            <ConfirmCard
              key={request.requestId}
              confirm={lastConfirm}
              prompt={request.prompt}
              options={request.options}
              onPick={(optionId) => void agent.respond([{ requestId: request.requestId, optionId }])}
            />
          ))}
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const value = String(new FormData(form).get("message") ?? "");
              if (!authenticated) {
                onLogin();
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
                authenticated ? "Ask Una about your positions…" : "Connect to ask Una"
              }
            />
            <button className="btn btn-accent btn-send" type="submit" disabled={isResuming || !authenticated}>
              Send
            </button>
          </form>
          <p className="dock-hint">Nothing moves until you approve it in your wallet.</p>
        </div>
      </footer>
    </section>
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
    return (
      <p className="tool-line">
        {part.toolName ?? "tool"} · {part.state === "input-available" ? "running" : "planning"}
      </p>
    );
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
  const data = unwrapToolOutput(output);
  const receipt = isRecord(data.receipt) ? data.receipt : looksLikeReceipt(data) ? data : null;
  const positions = Array.isArray(data.positions) ? data.positions : null;
  const card = typeof data.card === "string" ? data.card : null;
  const text = typeof data.text === "string" ? data.text : typeof output === "string" ? output : null;
  const note = typeof data.note === "string" ? data.note : null;
  const confirm = isConfirmView(data.confirm) ? data.confirm : null;

  if (receipt) {
    const hashes = asArray(receipt.hashes).map(String);
    if (typeof receipt.hash === "string") hashes.push(receipt.hash);
    const dry = receipt.dryRun !== false;
    const skipped = Boolean(receipt.skipped);
    const write = WRITE_TOOLS.has(toolName ?? "") || Boolean(receipt.action);
    const signed = hashes.length > 0 && !dry && !skipped;
    const actions = asArray(receipt.actions);
    return (
      <section className="receipt">
        <div className="receipt-head">
          <span>{String(receipt.action ?? toolName ?? "receipt")}</span>
          <span className={skipped ? "badge-skip" : signed ? "badge-live" : dry ? "badge-dry" : "badge-wait"}>
            {skipped ? "skipped" : signed ? "signed" : dry ? "dry-run" : write ? "awaiting Privy" : "live"}
          </span>
        </div>
        {confirm ? (
          <dl>
            <dt>pair</dt>
            <dd>
              {confirm.pair} · {confirm.protocol} · {confirm.feeLabel}
            </dd>
            {confirm.tickLower !== undefined ? (
              <>
                <dt>range</dt>
                <dd>
                  [{confirm.tickLower}, {confirm.tickUpper}]
                </dd>
              </>
            ) : null}
          </dl>
        ) : (
          <dl>
            {receipt.tokenId != null ? (
              <>
                <dt>token</dt>
                <dd>{String(receipt.tokenId)}</dd>
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
        )}
        {actions.length > 0 ? (
          <ol>
            {actions.map((item, i) => {
              const row = isRecord(item) ? item : {};
              return (
                <li key={i}>
                  {typeof row.kind === "string" ? <b>{row.kind} </b> : null}
                  {typeof row.description === "string" ? row.description : JSON.stringify(item)}
                </li>
              );
            })}
          </ol>
        ) : text && !confirm ? (
          <pre>{text}</pre>
        ) : null}
        {write && !signed && !skipped ? (
          <p className="tool-line">Not done. Confirm + Privy sign required to go live.</p>
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
            const row = isRecord(item) ? item : {};
            return (
              <div className="pos" key={String(row.tokenId ?? i)}>
                <span>
                  <b>{String(row.pair ?? row.tokenId ?? "position")}</b>
                  {row.protocol != null ? ` · ${String(row.protocol)}` : ""}
                </span>
                <span className={row.inRange === false ? "out" : "in"}>
                  {row.inRange === false ? "OOR" : row.inRange === true ? "in range" : ""}
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

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function looksLikeReceipt(value: Record<string, unknown>): boolean {
  return "dryRun" in value || "actions" in value || "treasuryFee" in value;
}

function short(value: string): string {
  if (value.length <= 12) return value;
  if (value.startsWith("0x")) return `${value.slice(0, 6)}…${value.slice(-4)}`;
  return value;
}
