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
    { name: 'Sobre nosotros', href: '#nosotros' },
    { name: 'Blog', href: '#blog' },
    { name: 'Contacto', href: '#contacto' },
    { name: 'Ayuda', href: '#ayuda' },
  ];

  const legalLinks = [
    { name: 'Política de privacidad', href: '#privacidad' },
    { name: 'Aviso legal', href: '#legal' },
    { name: 'Contacto', href: '#contacto' },
  ];

  return (
    <footer className="bg-[#1a365d] dark:bg-gray-950 text-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        {/* Main footer content */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 pb-12 border-b border-white/10">
          {/* Logo and description */}
          <div className="lg:col-span-1">
            <a href="/" className="inline-flex items-center space-x-1 text-2xl font-bold mb-4">
              <span className="text-white">PERFILIO</span>
              <span className="text-[#ed8936] text-3xl leading-none">.</span>
            </a>
            <p className="text-gray-300 text-sm leading-relaxed mb-6">
              Software de gestión empresarial con asistente IA para PYMEs españolas.
            </p>
            <div className="flex items-center space-x-2 text-sm">
              <span>Hecho en España</span>
              <span className="text-xl">🇪🇸</span>
            </div>
          </div>

          {/* Producto */}
          <div>
            <h3 className="text-lg font-bold mb-4">Producto</h3>
            <ul className="space-y-3">
              {productLinks.map((link) => (
                <li key={link.name}>
                  <a
                    href={link.href}
                    className="text-gray-300 hover:text-[#ed8936] transition-colors text-sm"
                  >
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Sectores */}
          <div>
            <h3 className="text-lg font-bold mb-4">Sectores</h3>
            <ul className="space-y-3">
              {sectorLinks.map((link) => (
                <li key={link.name}>
                  <a
                    href={link.href}
                    className="text-gray-300 hover:text-[#ed8936] transition-colors text-sm"
                  >
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Empresa */}
          <div>
            <h3 className="text-lg font-bold mb-4">Empresa</h3>
            <ul className="space-y-3">
              {companyLinks.map((link) => (
                <li key={link.name}>
                  <a
                    href={link.href}
                    className="text-gray-300 hover:text-[#ed8936] transition-colors text-sm"
                  >
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom section */}
        <div className="pt-8 flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
          {/* Copyright */}
          <div className="text-gray-400 text-sm">
            © 2026 Perfilio. Hecho en España 🇪🇸
          </div>

          {/* Legal links */}
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm">
            {legalLinks.map((link, index) => (
              <span key={link.name} className="flex items-center">
                <a
                  href={link.href}
                  className="text-gray-400 hover:text-[#ed8936] transition-colors"
                >
                  {link.name}
                </a>
                {index < legalLinks.length - 1 && (
                  <span className="ml-6 text-gray-600">|</span>
                )}
              </span>
            ))}
          </div>
        </div>

        {/* Social proof */}
        <div className="mt-8 pt-8 border-t border-white/10 text-center">
          <p className="text-gray-400 text-sm">
            Datos alojados en servidores seguros en la Unión Europea 🔒
          </p>
        </div>
      </div>
    </footer>
  );
}
