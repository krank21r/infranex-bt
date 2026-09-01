import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from './providers'
import { SupabaseProvider } from '@/lib/supabase-provider'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://infranex-bt.vercel.app'),
  title: {
    default: 'Infranex BT - Bittensor Subnet Intelligence Platform',
    template: '%s | Infranex BT',
  },
  description:
    'Advanced analytics and intelligence platform for Bittensor subnets. Track performance, profitability, and opportunities across the decentralized AI network.',
  keywords: [
    'Bittensor',
    'subnet',
    'TAO',
    'decentralized AI',
    'machine learning',
    'blockchain',
    'analytics',
    'mining',
    'validator',
  ],
  authors: [{ name: 'Infranex BT Team' }],
  creator: 'Infranex BT',
  publisher: 'Infranex BT',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://infranex.bt',
    title: 'Infranex BT - Bittensor Subnet Intelligence Platform',
    description:
      'Advanced analytics and intelligence platform for Bittensor subnets.',
    siteName: 'Infranex BT',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Infranex BT Dashboard',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Infranex BT - Bittensor Subnet Intelligence Platform',
    description:
      'Advanced analytics and intelligence platform for Bittensor subnets.',
    images: ['/og-image.png'],
    creator: '@infranexbt',
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon-16x16.png',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body
        className={`${inter.variable} font-sans antialiased bg-background text-foreground min-h-screen`}
      >
        <SupabaseProvider>
          <AuthProvider>{children}</AuthProvider>
        </SupabaseProvider>
      </body>
    </html>
  )
}