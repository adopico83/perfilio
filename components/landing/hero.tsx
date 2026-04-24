'use client';

const WHATSAPP_HREF =
  'https://wa.me/34697613884?text=Hola%2C%20he%20visto%20Perfilio%20en%20vuestra%20web%20y%20me%20gustar%C3%ADa%20ver%20c%C3%B3mo%20funciona';

export function Hero() {
  const checks = [
    'Hecho en Euskadi',
    'Para gremios y autónomos',
    'Sin instalaciones raras',
    'Tus datos seguros',
  ];

  return (
    <section suppressHydrationWarning className="relative overflow-hidden py-16 sm:py-20 lg:py-24">
      <div className="absolute inset-0 bg-[#0d1b2e]"></div>
      <div className="absolute inset-0 opacity-100 bg-[linear-gradient(to_right,rgba(237,137,54,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(237,137,54,0.06)_1px,transparent_1px)] bg-[length:48px_48px]"></div>
      <div className="absolute -top-28 -right-20 h-80 w-80 blur-3xl bg-[radial-gradient(circle,rgba(237,137,54,0.18),transparent_70%)]"></div>
      <div className="absolute -bottom-32 -left-16 h-96 w-96 blur-3xl bg-[radial-gradient(circle,rgba(26,54,93,0.8),transparent_70%)]"></div>

      <div className="relative">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-10 items-center">
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full px-4 py-2 bg-[rgba(237,137,54,0.12)] border border-[rgba(237,137,54,0.35)]">
                <span className="inline-flex h-2 w-2 rounded-full bg-[#ed8936] animate-pulse"></span>
                <span className="text-[11px] sm:text-xs font-semibold tracking-[0.12em] uppercase text-[#ed8936]">
                  Gremios del País Vasco
                </span>
              </div>

              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold text-white leading-[1.03] tracking-tight">
                El encargado que no <span className="text-[#ed8936]">duerme</span>
              </h1>

              <p className="text-lg sm:text-xl text-[rgba(255,255,255,0.6)] leading-relaxed max-w-xl">
                Tu agente gestiona presupuestos, obras, gastos y operarios mientras tú estás en faena.
              </p>

              <div className="flex flex-col sm:flex-row gap-4">
                <a
                  href={WHATSAPP_HREF}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-10 py-5 bg-[#ed8936] hover:bg-[#dd6b20] text-white text-lg font-bold rounded-[10px] transition-all duration-200 shadow-lg hover:shadow-xl hover:-translate-y-[1px]"
                >
                  <svg viewBox="0 0 32 32" className="h-5 w-5 fill-current" aria-hidden="true">
                    <path d="M19.11 17.2c-.28-.14-1.64-.81-1.89-.9-.25-.09-.43-.14-.61.14-.18.28-.71.9-.87 1.08-.16.18-.32.21-.6.07-.28-.14-1.17-.43-2.23-1.37-.82-.73-1.37-1.63-1.53-1.91-.16-.28-.02-.43.12-.57.12-.12.28-.32.43-.48.14-.16.18-.28.28-.46.09-.18.05-.35-.02-.49-.07-.14-.61-1.47-.84-2.02-.22-.53-.44-.46-.61-.47h-.52c-.18 0-.46.07-.7.35-.24.28-.92.9-.92 2.2 0 1.3.94 2.56 1.08 2.74.14.18 1.86 2.84 4.51 3.98.63.27 1.12.43 1.5.55.63.2 1.2.17 1.65.1.5-.07 1.64-.67 1.87-1.31.23-.64.23-1.19.16-1.31-.07-.11-.25-.18-.53-.32zM16 3.2A12.75 12.75 0 0 0 4.95 22.3L3.2 28.8l6.66-1.71A12.78 12.78 0 1 0 16 3.2zm0 23.22c-1.95 0-3.86-.53-5.52-1.54l-.4-.24-3.95 1.01 1.05-3.85-.26-.4a10.68 10.68 0 1 1 9.08 5.02z" />
                  </svg>
                  Pedir demo
                </a>
              </div>

              <div className="pt-1 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#c7d0de]">
                {checks.map((item) => (
                  <div key={item} className="inline-flex items-center gap-2">
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#ed8936] text-[10px] font-bold text-white">
                      ✓
                    </span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 bg-[#ed8936]/10 blur-3xl rounded-full"></div>
              <div className="relative bg-[#111c2d] rounded-2xl border border-[rgba(255,255,255,0.1)] overflow-hidden shadow-2xl">
                <div className="bg-[#1a365d] p-5 border-b border-[rgba(255,255,255,0.08)]">
                  <div className="flex items-center space-x-3">
                    <div className="text-3xl">🔨</div>
                    <div className="flex-1">
                      <h3 className="text-white font-bold text-lg">En obra</h3>
                      <div className="flex items-center space-x-2 mt-1">
                        <span className="inline-flex h-2 w-2 rounded-full bg-green-400 animate-pulse"></span>
                        <span className="text-green-300 text-sm font-medium ml-1">Operativo</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-4 space-y-4 bg-[#111c2d]">
                  <div
                    className="bg-[#162032] rounded-[10px] p-4 border border-[rgba(255,255,255,0.08)] opacity-0 translate-y-3"
                    style={{ animation: 'fadeUp 560ms ease-out 0.2s forwards' }}
                  >
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="inline-flex h-[6px] w-[6px] rounded-full bg-[#ed8936]"></span>
                      <p className="uppercase text-[11px] tracking-[0.08em] text-[rgba(255,255,255,0.5)]">
                        Dictado recibido
                      </p>
                    </div>
                    <p className="text-white font-medium">
                      Alicatado baño 18 m², mano de obra y material.
                    </p>
                  </div>

                  <div
                    className="bg-[#162032] rounded-[10px] p-4 border border-[rgba(255,255,255,0.08)] opacity-0 translate-y-3"
                    style={{ animation: 'fadeUp 560ms ease-out 0.7s forwards' }}
                  >
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="inline-flex h-[6px] w-[6px] rounded-full bg-[#667eea]"></span>
                      <p className="uppercase text-[11px] tracking-[0.08em] text-[rgba(255,255,255,0.5)]">
                        Presupuesto generado
                      </p>
                    </div>
                    <p className="text-white font-medium">Base 1.260,00 € · IVA 21%</p>
                    <p className="text-[rgba(255,255,255,0.45)] text-xs mt-1">Total 1.524,60 €</p>
                  </div>

                  <div
                    className="bg-[#162032] rounded-[10px] p-4 border border-[rgba(255,255,255,0.08)] opacity-0 translate-y-3"
                    style={{ animation: 'fadeUp 560ms ease-out 1.2s forwards' }}
                  >
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="inline-flex h-[6px] w-[6px] rounded-full bg-[#48bb78]"></span>
                      <p className="uppercase text-[11px] tracking-[0.08em] text-[rgba(255,255,255,0.5)]">
                        PDF listo para enviar
                      </p>
                    </div>
                    <p className="text-white font-medium">
                      Documento con partidas, mediciones y logo
                    </p>
                  </div>

                  <div
                    className="h-[2px] w-24 rounded-full bg-[#ed8936] opacity-0 translate-y-3"
                    style={{ animation: 'fadeUp 560ms ease-out 1.6s forwards' }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <style jsx>{`
        @keyframes fadeUp {
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
