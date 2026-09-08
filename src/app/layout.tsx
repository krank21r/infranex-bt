import type { Metadata } from "next";
import { Fraunces, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "./providers";

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
  axes: ["opsz", "SOFT"],
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter-tight",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "Infranex BT — Bittensor Subnet Intelligence Platform",
  description:
    "A single pane for every Bittensor subnet you track — scores, miners, profitability, and the workers that keep the picture current.",
  keywords: [
    "Bittensor",
    "subnet",
    "TAO",
    "decentralized AI",
    "machine learning",
    "blockchain",
    "analytics",
    "mining",
  ],
  authors: [{ name: "Infranex BT" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Infranex BT — Bittensor Subnet Intelligence Platform",
    description:
      "Advanced analytics and intelligence platform for Bittensor subnets.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${fraunces.variable} ${interTight.variable} ${jetbrains.variable} font-sans antialiased bg-background text-foreground min-h-screen`}
      >
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
