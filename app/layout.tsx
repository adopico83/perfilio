import type { Metadata } from 'next';
import { Geist, Geist_Mono, Playfair_Display } from 'next/font/google';
import { ThemeProvider } from '@/components/ui/theme-provider';
import DashboardShellProvider from '@/components/dashboard/dashboard-shell-provider';
import AppShellClient from '@/components/providers/app-shell-client';
import SessionProvider from '@/components/providers/session-provider';
import './globals.css';
import PwaRegister from '@/components/pwa/pwa-register';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const playfairDisplay = Playfair_Display({
  variable: '--font-serif',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Perfilio – Presupuestos, stock y facturas en un solo lugar',
  description:
    'Gestiona presupuestos automáticos, control de stock, facturas y WhatsApp con IA. Simplifica tu negocio.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#1a365d" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${playfairDisplay.variable} antialiased`}
      >
        <PwaRegister />
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <SessionProvider>
            <AppShellClient>
              <DashboardShellProvider>{children}</DashboardShellProvider>
            </AppShellClient>
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
