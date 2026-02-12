import Link from 'next/link';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Button } from '@/components/ui/button';

export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-brand-gray/20 bg-white/80 backdrop-blur-md dark:border-brand-gray/10 dark:bg-brand-blue/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="text-xl font-bold tracking-tight text-brand-blue dark:text-white"
        >
          Perfilio
        </Link>
        <nav className="flex items-center gap-4">
          <Link
            href="#features"
            className="hidden text-sm font-medium text-brand-gray hover:text-brand-blue dark:hover:text-brand-orange sm:inline"
          >
            Funcionalidades
          </Link>
          <ThemeToggle />
          <Button asChild size="sm" variant="primary">
            <Link href="#cta">Comenzar</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
