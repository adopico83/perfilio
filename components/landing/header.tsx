'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';

const WHATSAPP_HREF =
  'https://wa.me/34697613884?text=Hola%2C%20he%20visto%20Perfilio%20en%20vuestra%20web%20y%20me%20gustar%C3%ADa%20ver%20c%C3%B3mo%20funciona';

const accederClass =
  'inline-flex items-center justify-center px-5 py-2.5 text-white font-medium rounded-none transition-colors border border-white hover:bg-white hover:text-[#1C1917]';

interface HeaderProps {
  onOpenListaEspera?: () => void;
}

export function Header({ onOpenListaEspera }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showAgenteModal, setShowAgenteModal] = useState(false);

  const navLinkClass =
    'text-[#E8E0D5] hover:text-white font-medium transition-colors';

  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-[#1C1917]/90 border-b border-[#2C2420] shadow-sm">
      <nav className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-20 items-center justify-between">
          <div className="flex items-center">
            <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
              <Image
                src="/logo.png"
                alt="Perfilio"
                width={180}
                height={150}
                className="h-16 w-auto"
                priority
              />
            </Link>
          </div>

          <div className="hidden md:flex md:items-center md:space-x-8">
            <a href="#funcionalidades" className={navLinkClass}>
              Funcionalidades
            </a>
            <a href="#sectores" className={navLinkClass}>
              Sectores
            </a>
            <a href="#precios" className={navLinkClass}>
              Precios
            </a>
            <a
              href={WHATSAPP_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className={navLinkClass}
            >
              Contacto
            </a>
            <Link href="/login" className={accederClass}>
              Acceder
            </Link>
          </div>

          <div className="flex md:hidden">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="inline-flex items-center justify-center p-2 rounded-none text-[#E8E0D5] hover:text-white hover:bg-[#2C2420] transition-colors"
              aria-expanded={mobileMenuOpen}
            >
              <span className="sr-only">Abrir menú</span>
              {!mobileMenuOpen ? (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              ) : (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-[#2C2420]">
            <div className="flex flex-col space-y-4">
              <a href="#funcionalidades" className={navLinkClass} onClick={() => setMobileMenuOpen(false)}>
                Funcionalidades
              </a>
              <a href="#sectores" className={navLinkClass} onClick={() => setMobileMenuOpen(false)}>
                Sectores
              </a>
              <a href="#precios" className={navLinkClass} onClick={() => setMobileMenuOpen(false)}>
                Precios
              </a>
              <a
                href={WHATSAPP_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className={navLinkClass}
                onClick={() => setMobileMenuOpen(false)}
              >
                Contacto
              </a>
              <button
                type="button"
                className={`${navLinkClass} text-left`}
                onClick={() => {
                  setShowAgenteModal(true);
                  setMobileMenuOpen(false);
                }}
              >
                Agente IA
              </button>
              <Link href="/login" className={accederClass} onClick={() => setMobileMenuOpen(false)}>
                Acceder
              </Link>
            </div>
          </div>
        )}
      </nav>

      {showAgenteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowAgenteModal(false)}
            aria-hidden
          />
          <div className="relative w-full max-w-md bg-[#EDE9E0] rounded-none shadow-2xl border border-[#C8C4BB] overflow-hidden">
            <div className="flex justify-between items-center px-6 py-4 border-b border-[#C8C4BB]">
              <h2 className="text-lg font-bold text-foreground font-serif">Accede al Agente IA</h2>
              <button
                type="button"
                onClick={() => setShowAgenteModal(false)}
                className="p-1.5 rounded-none hover:bg-background text-[--muted-foreground] hover:text-foreground transition-colors"
                aria-label="Cerrar"
              >
                <span className="text-xl leading-none">&times;</span>
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <p className="text-sm text-[--muted-foreground]">
                El agente IA de Perfilio gestiona tu negocio de forma autónoma. Presupuestos,
                facturas, albaranes y mucho más.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="/login"
                  className="flex-1 inline-flex items-center justify-center px-4 py-2.5 rounded-none bg-accent hover:bg-[--brand-orange-hover] text-white text-sm font-semibold transition-colors"
                >
                  Acceder
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    if (onOpenListaEspera) {
                      onOpenListaEspera();
                    }
                    setShowAgenteModal(false);
                  }}
                  className="flex-1 inline-flex items-center justify-center px-4 py-2.5 rounded-none bg-accent hover:bg-[--brand-orange-hover] text-white text-sm font-semibold transition-colors"
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

