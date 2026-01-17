import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Gito IoT Platform',
  description: 'Production-grade IoT monitoring platform',
  icons: '/favicon.ico',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="theme-color" content="#0066CC" />
        <meta name="description" content={metadata.description as string} />
      </head>
      <body>{children}</body>
    </html>
  );
}
