'use client';

import Image from 'next/image';
import Link from 'next/link';

const WHATSAPP_CONTACT_HREF =
  'https://wa.me/34697613884?text=Hola!%20Me%20interesa%20saber%20m%C3%A1s%20sobre%20Perfilio%20y%20agendar%20una%20demo%20t%C3%A9cnica.';

const accederClass =
  'inline-flex items-center justify-center px-5 py-2.5 text-white font-medium rounded-none transition-colors border border-white hover:bg-white hover:text-[#1C1917]';

interface HeaderProps {
  onOpenListaEspera?: () => void;
  onGoToSectores?: () => void;
}

export function Header({ onGoToSectores }: HeaderProps) {
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

          <div className="hidden lg:flex lg:items-center lg:space-x-8">
            {onGoToSectores ? (
              <button
                type="button"
                onClick={onGoToSectores}
                className={navLinkClass}
              >
                Sectores
              </button>
            ) : null}
            <a
              href={WHATSAPP_CONTACT_HREF}
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

          <Link href="/login" className={`${accederClass} lg:hidden`}>
            Acceder
          </Link>
        </div>
      </nav>
    </header>
  );
}
