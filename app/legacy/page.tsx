import type { Metadata } from "next";
import { PortfolioApp } from "../portfolio-app";

export const metadata: Metadata = {
  title: "Wizzy: Legacy Meme Index",
  robots: { index: false },
};

export default function LegacyPage() {
  return <PortfolioApp />;
}
