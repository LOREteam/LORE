import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { headers } from 'next/headers';
import './globals.css';
import './lib/installBigIntJson';
import Providers from './providers';
import { ErrorCatcher } from './components/ErrorCatcher';
import { MaintenanceGate } from './components/MaintenanceGate';
import { assertProductionRuntimeConfig } from '../config/productionRuntime';

assertProductionRuntimeConfig("web");

const interDigits = localFont({
  src: './fonts/Inter-latin.woff2',
  weight: '400 900',
  display: 'swap',
  variable: '--font-lore-digits',
});

const loreTitle = localFont({
  src: './fonts/Cinzel-latin.woff2',
  weight: '600 900',
  display: 'swap',
  variable: '--font-lore-title',
});

const loreHud = localFont({
  src: [
    { path: './fonts/Rajdhani-500-latin.woff2', weight: '500' },
    { path: './fonts/Rajdhani-600-latin.woff2', weight: '600' },
    { path: './fonts/Rajdhani-700-latin.woff2', weight: '700' },
  ],
  display: 'swap',
  variable: '--font-lore-hud',
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://playlore.xyz';

export const metadata: Metadata = {
  title: 'LORE - Linea Mining Game',
  description: 'Mine, bet, and earn on Linea. LORE = Linea + ORE.',
  metadataBase: new URL(siteUrl),
  icons: {
    icon: { url: '/icon-64.png', type: 'image/png', sizes: '64x64' },
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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en">
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script nonce={nonce} src="/early-runtime.js" />
      </head>
      <body className={`${interDigits.variable} ${loreTitle.variable} ${loreHud.variable} antialiased`}>
        <ErrorCatcher />
        <MaintenanceGate>
          <Providers>{children}</Providers>
        </MaintenanceGate>
      </body>
    </html>
  );
}
