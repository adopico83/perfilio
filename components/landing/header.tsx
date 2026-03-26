'use client';

import { useState } from 'react';
import Image from 'next/image';

interface HeaderProps {
  onOpenListaEspera?: () => void;
}

export function Header({ onOpenListaEspera }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showAgenteModal, setShowAgenteModal] = useState(false);

  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-white/80 dark:bg-gray-900/80 border-b border-gray-200/50 dark:border-gray-800/50 shadow-sm">
      <nav className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-20 items-center justify-between">
          {/* Logo */}
          <div className="flex items-center">
            <a href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
              <Image 
                src="/logo.png" 
                alt="Perfilio" 
                width={180}
                height={150}
                className="h-16 w-auto"
                priority
              />
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
              onClick={(e) => {
                e.preventDefault();
                onOpenListaEspera?.();
              }}
              className="text-[#4a5568] dark:text-gray-300 hover:text-[#1a365d] dark:hover:text-white font-medium transition-colors"
            >
              Contacto
            </a>

            <a
              href="/login"
              className="inline-flex items-center justify-center px-5 py-2.5 bg-[#1a365d] hover:bg-[#2c5282] text-white font-medium rounded-lg transition-all duration-200 border border-[#1a365d]"
            >
              Acceder
            </a>

            {/* CTA Button */}
            {onOpenListaEspera ? (
              <button
                type="button"
                onClick={onOpenListaEspera}
                className="inline-flex items-center justify-center px-6 py-2.5 bg-[#ed8936] hover:bg-[#dd6b20] text-white font-bold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg"
              >
                Probar gratis
              </button>
            ) : (
              <a
                href="#probar"
                className="inline-flex items-center justify-center px-6 py-2.5 bg-[#ed8936] hover:bg-[#dd6b20] text-white font-bold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg"
              >
                Probar gratis
              </a>
            )}
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
                onClick={(e) => {
                  e.preventDefault();
                  onOpenListaEspera?.();
                  setMobileMenuOpen(false);
                }}
              >
                Contacto
              </a>
              <button
                type="button"
                className="text-[#4a5568] dark:text-gray-300 hover:text-[#1a365d] dark:hover:text-white font-medium transition-colors text-left"
                onClick={() => {
                  setShowAgenteModal(true);
                  setMobileMenuOpen(false);
                }}
              >
                Agente IA
              </button>
              <a
                href="/login"
                className="inline-flex items-center justify-center px-5 py-2.5 bg-[#1a365d] hover:bg-[#2c5282] text-white font-medium rounded-lg transition-all duration-200 border border-[#1a365d]"
                onClick={() => setMobileMenuOpen(false)}
              >
                Acceder
              </a>
              {onOpenListaEspera ? (
                <button
                  type="button"
                  onClick={() => {
                    onOpenListaEspera();
                    setMobileMenuOpen(false);
                  }}
                  className="inline-flex items-center justify-center px-6 py-2.5 bg-[#ed8936] hover:bg-[#dd6b20] text-white font-bold rounded-lg transition-all duration-200 shadow-md"
                >
                  Probar gratis
                </button>
              ) : (
                <a
                  href="#probar"
                  className="inline-flex items-center justify-center px-6 py-2.5 bg-[#ed8936] hover:bg-[#dd6b20] text-white font-bold rounded-lg transition-all duration-200 shadow-md"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Probar gratis
                </a>
              )}
            </div>
          </div>
        )}
      </nav>

      {showAgenteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowAgenteModal(false)}
            aria-hidden
          />
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-[#1a365d]">Accede al Agente IA</h2>
              <button
                type="button"
                onClick={() => setShowAgenteModal(false)}
                className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                aria-label="Cerrar"
              >
                <span className="text-xl leading-none">&times;</span>
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <p className="text-sm text-gray-700">
                El agente IA de Perfilio gestiona tu negocio de forma autónoma. Presupuestos,
                facturas, albaranes y mucho más.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href="/login"
                  className="flex-1 inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-[#1a365d] hover:bg-[#2c5282] text-white text-sm font-semibold transition-colors"
                >
                  Acceder
                </a>
                <button
                  type="button"
                  onClick={() => {
                    if (onOpenListaEspera) {
                      onOpenListaEspera();
                    }
                    setShowAgenteModal(false);
                  }}
                  className="flex-1 inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-[#ed8936] hover:bg-[#dd6b20] text-white text-sm font-semibold transition-colors"
                >
                  Unirse a la lista de espera
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
