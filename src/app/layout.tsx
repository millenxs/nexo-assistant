import type { Metadata } from 'next';
import { Newsreader, Schibsted_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
});

const schibstedGrotesk = Schibsted_Grotesk({
  subsets: ['latin'],
  variable: '--font-ui',
  weight: ['400', '500', '600', '700'],
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-data',
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'Nexo Assist · Service desk de TI',
  description: 'Seu problema de TI, resolvido em uma conversa. Service desk inteligente da Nexo.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${newsreader.variable} ${schibstedGrotesk.variable} ${ibmPlexMono.variable}`}
    >
      <body className="font-ui antialiased bg-[var(--paper)] text-[var(--ink)]">
        {children}
      </body>
    </html>
  );
}
