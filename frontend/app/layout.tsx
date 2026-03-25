import type { Metadata } from "next";
import { JetBrains_Mono, Outfit, Syne } from "next/font/google";
import { PropsWithChildren } from "react";
import "@solana/wallet-adapter-react-ui/styles.css";
import { Providers } from "@/components/providers";
import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-head",
  weight: ["400", "500", "600", "700", "800"]
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["300", "400", "500", "600"]
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"]
});

const metadataBase = process.env.NEXT_PUBLIC_APP_URL
  ? new URL(process.env.NEXT_PUBLIC_APP_URL)
  : new URL("http://localhost:3000");

export const metadata: Metadata = {
  title: {
    default: "Arxcess | Encrypted Digital Goods on Solana",
    template: "%s | Arxcess"
  },
  metadataBase,
  description: "Buy and sell encrypted digital products trustlessly on Solana. Files stay private until payment is finalized.",
  openGraph: {
    title: "Arxcess | Encrypted Marketplace",
    description: "The encrypted digital goods marketplace on Solana.",
    images: ["/og-image.png"]
  },
  twitter: {
    card: "summary_large_image",
    title: "Arxcess | Encrypted Marketplace",
    description: "Buy and sell encrypted digital products trustlessly on Solana.",
    images: ["/og-image.png"]
  }
};

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <body className={`${syne.variable} ${outfit.variable} ${jetbrainsMono.variable}`}>
        <Providers>
          <div className="app-theme">
            <div className="app-glow app-glow--violet" aria-hidden="true" />
            <div className="app-glow app-glow--cyan" aria-hidden="true" />
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
