import type { Metadata } from "next";
import { PropsWithChildren } from "react";
import "@solana/wallet-adapter-react-ui/styles.css";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arxcess",
  description: "Trust-minimized digital asset marketplace"
};

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
