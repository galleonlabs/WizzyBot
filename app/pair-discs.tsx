/** Two overlapping initials discs. Not token art. */

const TONES = [
  { bg: "#2a261c", fg: "#e8c07a" },
  { bg: "#1c2422", fg: "#8ec8b0" },
  { bg: "#241c1c", fg: "#d4a08c" },
  { bg: "#1c2028", fg: "#9aa8c0" },
  { bg: "#22201c", fg: "#c8b89a" },
  { bg: "#1a2220", fg: "#7fbf9a" },
] as const;

function toneFor(symbol: string): (typeof TONES)[number] {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 33 + symbol.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length] ?? TONES[0];
}

export function tokenInitial(symbol: string): string {
  const ch = symbol.replace(/^[^A-Za-z0-9]+/, "").charAt(0);
  return (ch || "?").toUpperCase();
}

export function PairDiscs({
  symbol0,
  symbol1,
  large = false,
}: {
  symbol0: string;
  symbol1: string;
  large?: boolean;
}) {
  const a = toneFor(symbol0);
  const b = toneFor(symbol1);
  return (
    <span className={`discs ${large ? "discs-lg" : ""}`} aria-hidden="true">
      <i className="disc" style={{ background: a.bg, color: a.fg }}>
        {tokenInitial(symbol0)}
      </i>
      <i className="disc" style={{ background: b.bg, color: b.fg }}>
        {tokenInitial(symbol1)}
      </i>
    </span>
  );
}
