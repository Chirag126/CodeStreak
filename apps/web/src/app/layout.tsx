import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/shell/site-footer';
import { SiteHeader } from '@/components/shell/site-header';
import { Providers } from './providers';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

// Absolute URLs for social images (og:image, twitter:image). Behind Render's proxy the request
// host is internal, so the public APP_URL is used; locally Next falls back to localhost.
const metadataBase = (() => {
  try {
    return process.env.APP_URL ? new URL(process.env.APP_URL) : undefined;
  } catch {
    return undefined;
  }
})();

export const metadata: Metadata = {
  metadataBase,
  title: { default: 'CodeStreak', template: '%s · CodeStreak' },
  description: 'Put your money where your commits are. Coding accountability on Solana devnet.',
};

export const viewport: Viewport = {
  themeColor: '#0a0c0f',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen">
        <Providers>
          <a
            href="#main"
            className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
          >
            Skip to content
          </a>
          <div className="flex min-h-screen flex-col">
            <SiteHeader />
            <main id="main" className="flex-1">
              {children}
            </main>
            <SiteFooter />
          </div>
        </Providers>
      </body>
    </html>
  );
}
