import Link from 'next/link';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-brand-gray/20 bg-white px-4 py-12 dark:border-brand-gray/10 dark:bg-brand-blue/5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <Link
            href="/"
            className="text-lg font-bold text-brand-blue dark:text-white"
          >
            Perfilio
          </Link>
          <nav className="flex gap-8 text-sm text-brand-gray dark:text-brand-gray/90">
            <Link href="#features" className="hover:text-brand-blue dark:hover:text-brand-orange">
              Funcionalidades
            </Link>
            <Link href="#" className="hover:text-brand-blue dark:hover:text-brand-orange">
              Privacidad
            </Link>
            <Link href="#" className="hover:text-brand-blue dark:hover:text-brand-orange">
              Términos
            </Link>
          </nav>
        </div>
        <p className="mt-8 text-center text-sm text-brand-gray dark:text-brand-gray/80">
          © {currentYear} Perfilio. Todos los derechos reservados.
        </p>
      </div>
    </footer>
  );
}
