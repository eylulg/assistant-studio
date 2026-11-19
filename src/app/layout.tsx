import type { ReactNode } from 'react';
import { AppShell, SiteFooter, themeInitScript } from '@eylulg/ui/chrome';
import '@eylulg/ui/fonts.css';
import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';
import { Nav } from './nav';

export const metadata: Metadata = {
  title: 'Assistant Studio',
  description:
    'A streaming assistant UI with tool use, approval for actions with side effects, interruptible streams, forked conversations and an eval suite.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0e12' },
  ],
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // The theme script changes the class on <html> before React hydrates, so suppress the attribute mismatch.
    <html lang='en' suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <AppShell
          maxWidth='7xl'
          header={<Nav />}
          footer={<SiteFooter currentId='assistant-studio' />}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
