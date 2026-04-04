import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import './lib/installBigIntJson';
import Providers from './providers';
import { ErrorCatcher } from './components/ErrorCatcher';
import { MaintenanceGate } from './components/MaintenanceGate';

const interDigits = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  display: 'swap',
  variable: '--font-lore-digits',
});

const EARLY_CHUNK_RECOVERY_SCRIPT = `
(() => {
  if (typeof BigInt !== "undefined" && typeof BigInt.prototype.toJSON !== "function") {
    Object.defineProperty(BigInt.prototype, "toJSON", {
      value() {
        return this.toString();
      },
      configurable: true,
      writable: true,
    });
  }

  const KEY = "lore:chunk-reload-once";
  const WINDOW_MS = 15000;

  const isChunkLoadMessage = (value) => {
    const msg = String(value || "").toLowerCase();
    return msg.includes("chunkloaderror")
      || (msg.includes("loading chunk") && msg.includes("/_next/static/chunks/"))
      || (msg.includes("loading chunk") && msg.includes("failed"));
  };

  const hasRecentRetry = () => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return false;
      const lastAt = Number(raw);
      return Number.isFinite(lastAt) && Date.now() - lastAt < WINDOW_MS;
    } catch {
      return false;
    }
  };

  const reloadOnce = (message) => {
    try {
      if (hasRecentRetry()) return false;
      sessionStorage.setItem(KEY, Date.now().toString());
    } catch {}

    try {
      const url = new URL(window.location.href);
      url.searchParams.set("_r", Date.now().toString());
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
    return true;
  };

  window.addEventListener("pageshow", () => {
    window.setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(KEY);
        if (!raw) return;
        const lastAt = Number(raw);
        if (!Number.isFinite(lastAt) || Date.now() - lastAt >= WINDOW_MS) {
          sessionStorage.removeItem(KEY);
        }
      } catch {}
    }, WINDOW_MS);
  });

  window.addEventListener("error", (event) => {
    const message = event?.error?.message || event?.message || "";
    if (!isChunkLoadMessage(message)) return;
    if (reloadOnce(message)) {
      event.preventDefault?.();
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const message =
      reason instanceof Error
        ? \`\${reason.name}: \${reason.message}\`
        : typeof reason === "string"
          ? reason
          : "";
    if (!isChunkLoadMessage(message)) return;
    if (reloadOnce(message)) {
      event.preventDefault?.();
    }
  });
})();
`;

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
        <script dangerouslySetInnerHTML={{ __html: EARLY_CHUNK_RECOVERY_SCRIPT }} />
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
