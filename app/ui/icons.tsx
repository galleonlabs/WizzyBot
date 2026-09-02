export const BRAND_ASSETS = {
  base: "https://assets.relay.link/icons/8453/light.png",
  robinhood: "https://assets.relay.link/icons/4663/light.png",
  solana: "https://assets.relay.link/icons/792703809/light.png",
  fomo: "https://fomo.family/favicon.svg",
} as const;

export function TokenIcon({ symbol, src, color, size }: { symbol: string; src?: string | null; color?: string; size?: number }) {
  return <span className="token-icon" style={{ backgroundColor: color ?? "var(--surface-3)", ...(size ? { width: size, height: size } : {}) }} aria-hidden="true">
    {src ? <img src={src} alt="" /> : <b>{symbol.slice(0, 1)}</b>}
  </span>;
}

export function BrandLogo({ brand, label, compact = false }: { brand: keyof typeof BRAND_ASSETS; label: string; compact?: boolean }) {
  return <span className={`brand-logo is-${brand} ${compact ? "is-compact" : ""}`}>
    <img src={BRAND_ASSETS[brand]} alt="" aria-hidden="true" />
    {compact ? null : <span>{label}</span>}
  </span>;
}

export function WalletIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3H6.5a1.5 1.5 0 0 0 0 3H20v8H6a2 2 0 0 1-2-2V7.5Z"/><circle cx="16.5" cy="15" r="1.25"/></svg>; }
export function SearchIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4 4" /></svg>; }
export function ChevronIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5" /></svg>; }
export function ExternalLinkIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5" /></svg>; }
export function CloseIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>; }
export function SendIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-5 14-2.5-5.5L5 12Z" /><path d="m11.5 13.5 3-3" /></svg>; }
export function DisconnectIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3M14 8l4 4-4 4M18 12H9" /></svg>; }
export function CheckIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12.5 4 4 8-9" /></svg>; }
export function PlusIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>; }
export function MinusIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>; }
export function CoinsIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="9" cy="7" rx="6" ry="2.6" /><path d="M3 7v5c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6V7" /><path d="M3 12v5c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6v-5" /><path d="M15 9.5c3.3 0 6 1.2 6 2.6V17c0 1.4-2.7 2.6-6 2.6" /></svg>; }
export function RangeIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16" /><path d="M8 8v8M16 8v8" /><path d="m6 10-2 2 2 2M18 10l2 2-2 2" /></svg>; }
export function ExitIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l5 4-5 4M20 12H9" /></svg>; }
export function XIcon() { return <svg className="x-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117Z" /></svg>; }

export function ThemeIcon({ preference }: { preference: "system" | "light" | "dark" }) {
  if (preference === "light") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
  if (preference === "dark") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2.5" /><path d="M8 21h8M12 17v4M12 4v13" /></svg>;
}
