import Link from 'next/link';

export function Footer() {
  const productLinks = [
    { name: 'Asistente IA', href: '#asistente' },
    { name: 'Presupuestos', href: '#presupuestos' },
    { name: 'Facturación', href: '#facturacion' },
    { name: 'Stock', href: '#stock' },
    { name: 'Precios', href: '#precios' },
  ];

  const sectorLinks = [
    { name: 'Talleres', href: '#talleres' },
    { name: 'Servicios', href: '#servicios' },
    { name: 'Comercios', href: '#comercios' },
    { name: 'Todos los sectores', href: '#sectores' },
  ];

  const companyLinks = [
    { name: 'Contacto', href: '#contacto' },
    { name: 'Ayuda', href: '#ayuda' },
  ];

  const legalLinks = [
    { name: 'Política de privacidad', href: '#privacidad' },
    { name: 'Aviso legal', href: '#legal' },
    { name: 'Contacto', href: '#contacto' },
  ];

  return (
    <footer className="bg-background text-foreground border-t border-[--border]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 pb-12 border-b border-[--border]">
          <div className="lg:col-span-1">
            <Link href="/" className="inline-flex items-center space-x-1 text-2xl font-bold mb-4 font-serif">
              <span className="text-foreground">PERFILIO</span>
              <span className="text-accent text-3xl leading-none">.</span>
            </Link>
            <p className="text-[--muted-foreground] text-sm leading-relaxed mb-6">
              Software de gestión empresarial con asistente IA para PYMEs españolas.
            </p>
            <p className="text-foreground text-sm font-semibold mb-4">
              WhatsApp: 697 613 884
            </p>
            <div className="flex items-center space-x-2 text-sm text-[--muted-foreground]">
              <span>Hecho en España</span>
              <span className="text-xl">🇪🇸</span>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-bold mb-4 font-serif">Producto</h3>
            <ul className="space-y-3">
              {productLinks.map((link) => (
                <li key={link.name}>
                  <a
                    href={link.href}
                    className="text-[--muted-foreground] hover:text-accent transition-colors text-sm"
                  >
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-bold mb-4 font-serif">Sectores</h3>
            <ul className="space-y-3">
              {sectorLinks.map((link) => (
                <li key={link.name}>
                  <a
                    href={link.href}
                    className="text-[--muted-foreground] hover:text-accent transition-colors text-sm"
                  >
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-bold mb-4 font-serif">Empresa</h3>
            <ul className="space-y-3">
              {companyLinks.map((link) => (
                <li key={link.name}>
                  <a
                    href={link.href}
                    className="text-[--muted-foreground] hover:text-accent transition-colors text-sm"
                  >
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="pt-8 flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
          <div className="text-[--muted-foreground] text-sm">
            © 2026 Perfilio. Hecho en España 🇪🇸
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 text-sm">
            {legalLinks.map((link, index) => (
              <span key={link.name} className="flex items-center">
                <a
                  href={link.href}
                  className="text-[--muted-foreground] hover:text-accent transition-colors"
                >
                  {link.name}
                </a>
                {index < legalLinks.length - 1 && (
                  <span className="ml-6 text-[--border]">|</span>
                )}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-[--border] text-center">
          <p className="text-[--muted-foreground] text-sm">
            Datos alojados en servidores seguros en la Unión Europea 🔒
          </p>
        </div>
      </div>
    </footer>
  );
}
