import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "./providers";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space-grotesk",
});

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
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

// Runs before first paint: restores the user's saved theme, defaulting to light.
const THEME_INIT = `try{if(localStorage.getItem("infranex-theme")==="dark"){document.documentElement.classList.add("dark")}}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body
        className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrains.variable} font-sans antialiased bg-background text-foreground min-h-screen`}
      >
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
