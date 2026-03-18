import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/ui/theme-provider';
import DashboardShellProvider from '@/components/dashboard/dashboard-shell-provider';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
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
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <DashboardShellProvider>{children}</DashboardShellProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
