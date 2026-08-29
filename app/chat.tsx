"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEveAgent } from "eve/react";

export function Chat() {
  const { ready, authenticated, login, logout, user, getAccessToken } = usePrivy();
  const agent = useEveAgent({
    headers: async () => {
      const token = await getAccessToken();
      return token ? { authorization: `Bearer ${token}` } : {};
    },
  });
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isResuming = agent.status === "resuming";

  const pending = agent.data.messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      if (part.type !== "dynamic-tool" || part.state !== "approval-requested") return [];
      const request = part.toolMetadata?.eve?.inputRequest;
      return request ? [request] : [];
    }),
  );

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px 64px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
        <div>
          <p style={{ letterSpacing: "0.14em", fontSize: 12, color: "var(--muted)", margin: 0 }}>UNABOT</p>
          <h1 style={{ fontSize: 36, margin: "8px 0 6px" }}>Uniswap LP on autopilot.</h1>
          <p style={{ color: "var(--muted)", margin: 0 }}>v2, v3, and v4. You keep the position.</p>
          <p style={{ color: "var(--muted)", margin: "6px 0 0" }}>Compound, re-range, exit.</p>
        </div>
        <div>
          {!ready ? (
            <span style={{ color: "var(--muted)" }}>…</span>
          ) : authenticated ? (
            <button type="button" onClick={() => void logout()}>
              {user?.email?.address ?? user?.wallet?.address?.slice(0, 8) ?? "Sign out"}
            </button>
          ) : (
            <button type="button" onClick={() => void login()}>
              Sign in
            </button>
          )}
        </div>
      </header>

      <section style={{ marginTop: 28, borderTop: "1px solid var(--line)", paddingTop: 20 }}>
        {agent.data.messages.map((message) => (
          <article key={message.id} style={{ marginBottom: 16 }}>
            <header style={{ color: "var(--muted)", fontSize: 12, textTransform: "uppercase" }}>{message.role}</header>
            {message.parts.map((part, index) =>
              part.type === "text" ? (
                <p key={index} style={{ whiteSpace: "pre-wrap", margin: "6px 0 0" }}>
                  {part.text}
                </p>
              ) : null,
            )}
          </article>
        ))}
        {pending.map((request) => (
          <fieldset key={request.requestId} style={{ border: "1px solid var(--line)", margin: "12px 0", padding: 12 }}>
            <legend>{request.kind === "tool-approval" ? "Confirm live write" : "Question"}</legend>
            <p>{request.prompt}</p>
            {request.options?.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => void agent.respond([{ requestId: request.requestId, optionId: option.id }])}
                style={{ marginRight: 8 }}
              >
                {option.label}
              </button>
            ))}
          </fieldset>
        ))}
        {agent.error ? <p style={{ color: "#ff8a80" }}>{agent.error.message}</p> : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const message = String(form.get("message") ?? "").trim();
            if (message && !isResuming) {
              void agent.send(message, isBusy ? { turnPolicy: "steer" } : undefined);
              event.currentTarget.reset();
            }
          }}
        >
          <input
            name="message"
            disabled={isResuming || !authenticated}
            placeholder={authenticated ? "List my positions, status a tokenId, or plan a compound…" : "Sign in with Privy to chat"}
            style={{ width: "100%", padding: "12px 14px", background: "#12161b", color: "var(--fg)", border: "1px solid var(--line)" }}
          />
          <button type="submit" disabled={isResuming || !authenticated} style={{ marginTop: 10, background: "var(--accent)", color: "#111", border: 0, padding: "8px 14px" }}>
            Send
          </button>
        </form>
      </section>
    </main>
  );
}
