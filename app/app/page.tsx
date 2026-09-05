import type { Metadata } from "next";
import { PortfolioApp } from "../portfolio-app";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AppPage() {
  return <PortfolioApp />;
}
