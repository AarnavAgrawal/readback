import type { Metadata, Viewport } from "next";
import { B612, B612_Mono } from "next/font/google";
import Link from "next/link";
import { BudgetPill } from "./_components/BudgetPill";
import "./globals.css";

// B612 was drawn for Airbus cockpit displays; the videos use it too.
const b612 = B612({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-b612", display: "swap" });
const b612Mono = B612_Mono({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-b612-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Readback — ATC radio, turned into video",
  description:
    "Real air traffic control radio moments, turned into short vertical videos automatically. Built on the Enhanced Radar API.",
};

export const viewport: Viewport = {
  themeColor: "#03101B",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${b612.variable} ${b612Mono.variable}`} data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <Link href="/" className="wordmark">
            <span className="wordmark-mark" aria-hidden="true" />
            <span>Readback</span>
            <span className="wordmark-sub">on Enhanced Radar</span>
          </Link>
          <BudgetPill />
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer">
          <p>Radio data: Enhanced Radar · Storyboards: Claude · Video: Remotion</p>
        </footer>
      </body>
    </html>
  );
}
