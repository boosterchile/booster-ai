import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Booster AI — Logística sostenible',
  description:
    'Marketplace B2B de logística sostenible para transportistas y generadores de carga en Chile.',
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-CL">
      <body className="bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
