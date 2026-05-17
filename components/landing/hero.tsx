'use client';

const WHATSAPP_HREF =
  'https://wa.me/34697613884?text=Hola%2C%20he%20visto%20Perfilio%20en%20vuestra%20web%20y%20me%20gustar%C3%ADa%20ver%20c%C3%B3mo%20funciona';

const MARQUEE_TEXT =
  'AGENTE ACTIVO → DICTADO RECIBIDO → PRESUPUESTO GENERADO → PDF LISTO → HACIENDA CONECTADA → OBRA REGISTRADA → FACTURA EMITIDA → ';

export function Hero() {
  return (
    <section suppressHydrationWarning className="relative overflow-hidden bg-background">
      {/* Marquesina */}
      <div className="border-b border-[#C8C4BB] overflow-hidden py-3 bg-background">
        <div className="hero-marquee-track flex w-max">
          <span className="hero-marquee-content px-4 font-mono text-sm tracking-wide text-[#A04A2F]">
            {MARQUEE_TEXT}
          </span>
          <span
            className="hero-marquee-content px-4 font-mono text-sm tracking-wide text-[#A04A2F]"
            aria-hidden
          >
            {MARQUEE_TEXT}
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 sm:py-20 lg:py-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          {/* Columna izquierda — titular asimétrico */}
          <div className="space-y-10">
            <div className="flex flex-col lg:flex-row lg:items-start lg:gap-10">
              <h1 className="font-serif text-7xl md:text-8xl font-bold text-foreground leading-none tracking-tight text-left">
                El encargado que no <span className="text-accent">duerme</span>
              </h1>
              <p className="mt-6 lg:mt-2 font-mono text-sm text-[--muted-foreground] leading-relaxed max-w-xs shrink-0">
                Tu agente gestiona presupuestos, obras, gastos y operarios mientras tú estás en faena.
              </p>
            </div>

            <a
              href={WHATSAPP_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-10 py-5 bg-accent hover:bg-[--brand-orange-hover] text-white text-lg font-bold rounded-none transition-all duration-200 hover:-translate-y-0.5"
            >
              <svg viewBox="0 0 32 32" className="h-5 w-5 fill-current" aria-hidden="true">
                <path d="M19.11 17.2c-.28-.14-1.64-.81-1.89-.9-.25-.09-.43-.14-.61.14-.18.28-.71.9-.87 1.08-.16.18-.32.21-.6.07-.28-.14-1.17-.43-2.23-1.37-.82-.73-1.37-1.63-1.53-1.91-.16-.28-.02-.43.12-.57.12-.12.28-.32.43-.48.14-.16.18-.28.28-.46.09-.18.05-.35-.02-.49-.07-.14-.61-1.47-.84-2.02-.22-.53-.44-.46-.61-.47h-.52c-.18 0-.46.07-.7.35-.24.28-.92.9-.92 2.2 0 1.3.94 2.56 1.08 2.74.14.18 1.86 2.84 4.51 3.98.63.27 1.12.43 1.5.55.63.2 1.2.17 1.65.1.5-.07 1.64-.67 1.87-1.31.23-.64.23-1.19.16-1.31-.07-.11-.25-.18-.53-.32zM16 3.2A12.75 12.75 0 0 0 4.95 22.3L3.2 28.8l6.66-1.71A12.78 12.78 0 1 0 16 3.2zm0 23.22c-1.95 0-3.86-.53-5.52-1.54l-.4-.24-3.95 1.01 1.05-3.85-.26-.4a10.68 10.68 0 1 1 9.08 5.02z" />
              </svg>
              Pedir demo
            </a>
          </div>

          {/* Mock En obra */}
          <div className="relative lg:mt-4">
            <div className="relative bg-[#EDE9E0] rounded-none border border-[#C8C4BB] overflow-hidden">
              <div className="bg-background p-5 border-b border-[#C8C4BB]">
                <div className="flex items-center space-x-3">
                  <span className="text-3xl" aria-hidden>
                    🔨
                  </span>
                  <div className="flex-1">
                    <h3 className="text-foreground font-bold text-lg font-serif">En obra</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="inline-flex h-2 w-2 rounded-full bg-green-600 animate-pulse" />
                      <span className="text-green-700 text-sm font-mono font-medium">Operativo</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 space-y-4 bg-[#EDE9E0]">
                <div
                  className="bg-background p-4 border border-[#C8C4BB] opacity-0 translate-y-3"
                  style={{ animation: 'heroFadeUp 560ms ease-out 0.2s forwards' }}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="inline-flex h-[6px] w-[6px] rounded-full bg-accent" />
                    <p className="uppercase font-mono text-[11px] tracking-[0.08em] text-[--muted-foreground]">
                      Dictado recibido
                    </p>
                  </div>
                  <p className="text-foreground font-medium text-sm">
                    Alicatado baño 18 m², mano de obra y material.
                  </p>
                </div>

                <div
                  className="bg-background p-4 border border-[#C8C4BB] opacity-0 translate-y-3"
                  style={{ animation: 'heroFadeUp 560ms ease-out 0.7s forwards' }}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="inline-flex h-[6px] w-[6px] rounded-full bg-[#667eea]" />
                    <p className="uppercase font-mono text-[11px] tracking-[0.08em] text-[--muted-foreground]">
                      Presupuesto generado
                    </p>
                  </div>
                  <p className="text-foreground font-medium text-sm">Base 1.260,00 € · IVA 21%</p>
                  <p className="text-[--muted-foreground] font-mono text-xs mt-1">Total 1.524,60 €</p>
                </div>

                <div
                  className="bg-background p-4 border border-[#C8C4BB] opacity-0 translate-y-3"
                  style={{ animation: 'heroFadeUp 560ms ease-out 1.2s forwards' }}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="inline-flex h-[6px] w-[6px] rounded-full bg-green-600" />
                    <p className="uppercase font-mono text-[11px] tracking-[0.08em] text-[--muted-foreground]">
                      PDF listo para enviar
                    </p>
                  </div>
                  <p className="text-foreground font-medium text-sm">
                    Documento con partidas, mediciones y logo
                  </p>
                </div>

                <div
                  className="h-[2px] w-24 bg-accent opacity-0 translate-y-3"
                  style={{ animation: 'heroFadeUp 560ms ease-out 1.6s forwards' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .hero-marquee-track {
          animation: heroMarquee 30s linear infinite;
        }
        .hero-marquee-content {
          white-space: nowrap;
        }
        @keyframes heroMarquee {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
        @keyframes heroFadeUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </section>
  );
}


