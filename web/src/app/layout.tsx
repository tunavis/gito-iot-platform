import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Gito IoT Platform',
  description: 'Production-grade IoT monitoring platform',
  viewport: 'width=device-width, initial-scale=1',
  icons: '/favicon.ico',
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
