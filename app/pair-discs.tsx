/** Two overlapping initials discs. Not token art. */

const TONES = [
  { bg: "#3d2432", fg: "#ffb3c6" },
  { bg: "#1d322c", fg: "#7dffc8" },
  { bg: "#2a2840", fg: "#c9b8ff" },
  { bg: "#33281c", fg: "#ffd39a" },
  { bg: "#1c2c3a", fg: "#9ad4ff" },
  { bg: "#32241c", fg: "#ffc2a0" },
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
