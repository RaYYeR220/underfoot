import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import { Entrance } from "@/components/entrance";
import { QueryProvider } from "@/components/query-provider";

import "./globals.css";

const gambetta = localFont({
  src: "./fonts/Gambetta-Medium.woff2",
  weight: "500",
  variable: "--font-gambetta",
  display: "swap",
});

const switzer = localFont({
  src: [
    { path: "./fonts/Switzer-Regular.woff2", weight: "400" },
    { path: "./fonts/Switzer-Medium.woff2", weight: "500" },
  ],
  variable: "--font-switzer",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Underfoot — a floor of Stock Tokens under $WIF", template: "%s · Underfoot" },
  description:
    "A contract with no owner holds a basket of Robinhood Chain Stock Tokens. Burn $WIF to take your slice, in kind. Every burn raises the floor for everyone left.",
};

export const viewport: Viewport = {
  themeColor: "#17120d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${gambetta.variable} ${switzer.variable} ${jetbrains.variable}`}>
      <body>
        <div className="pools" aria-hidden />
        <div className="dot-grid" aria-hidden />
        <div className="grain" aria-hidden />
        <QueryProvider>{children}</QueryProvider>
        <Entrance />
      </body>
    </html>
  );
}
