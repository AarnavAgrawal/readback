import type { Metadata, Viewport } from "next";
import { Overpass, Vollkorn } from "next/font/google";
import Link from "next/link";
import "./globals.css";

// Overpass descends from Highway Gothic, the lettering on American road and airfield signs.
const overpass = Overpass({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-overpass", display: "swap" });
const vollkorn = Vollkorn({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-vollkorn", display: "swap" });

export const metadata: Metadata = {
  title: "Readback",
  description: "Short vertical videos of real air traffic control radio.",
};

export const viewport: Viewport = {
  themeColor: "#ffd100",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${overpass.variable} ${vollkorn.variable}`} data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <Link href="/" className="wordmark">
            Readback
          </Link>
          <nav className="site-nav" aria-label="Site">
            <Link href="/#gallery">Videos</Link>
            <Link href="/#make">Make one</Link>
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer">
          <p>Every call in these videos really happened.</p>
        </footer>
      </body>
    </html>
  );
}
