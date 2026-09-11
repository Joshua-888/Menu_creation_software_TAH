import type { Metadata } from "next";
import { Figtree, Syne } from "next/font/google";
import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  display: "swap",
});

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TakeAwayHero · Menu Operator Portal",
  description: "Internal TakeAwayHero employee portal for merchant menu migrations",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${syne.variable} ${figtree.variable}`}>
      <body
        style={
          {
            ["--font-display" as string]: "var(--font-syne), sans-serif",
            ["--font-body" as string]: "var(--font-figtree), sans-serif",
          } as React.CSSProperties
        }
      >
        {children}
      </body>
    </html>
  );
}
