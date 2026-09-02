import type { Metadata } from "next";
import { PortfolioApp } from "../portfolio-app";

export const metadata: Metadata = {
  title: "Wizzy Admin",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <PortfolioApp />;
}
