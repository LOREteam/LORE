import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import './lib/installBigIntJson';
import Providers from './providers';
import { ErrorCatcher } from './components/ErrorCatcher';
import { MaintenanceGate } from './components/MaintenanceGate';
import { assertProductionRuntimeConfig } from '../config/productionRuntime';

assertProductionRuntimeConfig("web");

const interDigits = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  display: 'swap',
  variable: '--font-lore-digits',
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lore.game';

export const metadata: Metadata = {
  title: 'LORE - Linea Mining Game',
  description: 'Mine, bet, and earn on Linea. LORE = Linea + ORE.',
  metadataBase: new URL(siteUrl),
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.png', type: 'image/png', sizes: '512x512' },
    ],
    shortcut: '/favicon.ico',
    apple: '/icon.png',
  },
  openGraph: {
    title: 'LORE - Linea Mining Game',
    description: 'Mine, bet, and earn on Linea. LORE = Linea + ORE.',
    type: 'website',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LORE - Linea Mining Game',
    description: 'Mine, bet, and earn on Linea. LORE = Linea + ORE.',
    images: ['/opengraph-image'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/icon.png" type="image/png" sizes="512x512" />
        <link rel="apple-touch-icon" href="/icon.png" />
        <Script src="/early-runtime.js" strategy="beforeInteractive" />
      </head>
      <body className={`${interDigits.variable} antialiased`}>
        <ErrorCatcher />
        <MaintenanceGate>
          <Providers>{children}</Providers>
        </MaintenanceGate>
      </body>
    </html>
  );
}
