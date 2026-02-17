'use client';

import { useState } from 'react';

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-sm">
      <nav className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <div className="flex items-center">
            <a href="/" className="flex items-center space-x-1 text-2xl font-bold">
              <span className="text-[#1a365d] dark:text-white">PERFILIO</span>
              <span className="text-[#ed8936] text-3xl leading-none">.</span>
            </a>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex md:items-center md:space-x-8">
            <a
              href="#funcionalidades"
              className="text-[#4a5568] dark:text-gray-300 hover:text-[#1a365d] dark:hover:text-white font-medium transition-colors"
            >
              Funcionalidades
            </a>
            <a
              href="#sectores"
              className="text-[#4a5568] dark:text-gray-300 hover:text-[#1a365d] dark:hover:text-white font-medium transition-colors"
            >
              Sectores
            </a>
            <a
              href="#precios"
              className="text-[#4a5568] dark:text-gray-300 hover:text-[#1a365d] dark:hover:text-white font-medium transition-colors"
            >
              Precios
            </a>
            <a
              href="#contacto"
              className="text-[#4a5568] dark:text-gray-300 hover:text-[#1a365d] dark:hover:text-white font-medium transition-colors"
            >
              Contacto
            </a>

            {/* CTA Button */}
            <a
              href="#probar"
              className="inline-flex items-center justify-center px-6 py-2.5 bg-[#ed8936] hover:bg-[#dd6b20] text-white font-bold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg"
            >
              Probar gratis
            </a>
          </div>

          {/* Mobile menu button */}
          <div className="flex md:hidden">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="inline-flex items-center justify-center p-2 rounded-lg text-[#4a5568] dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              aria-expanded="false"
            >
              <span className="sr-only">Abrir menú</span>
              {!mobileMenuOpen ? (
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                  />
                </svg>
              ) : (
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-gray-200 dark:border-gray-800">
            <div className="flex flex-col space-y-4">
              <a
                href="#funcionalidades"
                className="text-[#4a5568] dark:text-gray-300 hover:text-[#1a365d] dark:hover:text-white font-medium transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                Funcionalidades
              </a>
              <a
                href="#sectores"
                className="text-[#4a5568] dark:text-gray-300 hover:text-[#1a365d] dark:hover:text-white font-medium transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                Sectores
              </a>
              <a
                href="#precios"
                className="text-[#4a5568] dark:text-gray-300 hover:text-[#1a365d] dark:hover:text-white font-medium transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                Precios
              </a>
              <a
                href="#contacto"
                className="text-[#4a5568] dark:text-gray-300 hover:text-[#1a365d] dark:hover:text-white font-medium transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                Contacto
              </a>
              <a
                href="#probar"
                className="inline-flex items-center justify-center px-6 py-2.5 bg-[#ed8936] hover:bg-[#dd6b20] text-white font-bold rounded-lg transition-all duration-200 shadow-md"
                onClick={() => setMobileMenuOpen(false)}
              >
                Probar gratis
              </a>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
