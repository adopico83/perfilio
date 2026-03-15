interface CtaProps {
  onOpenListaEspera?: () => void;
}

export function Cta({ onOpenListaEspera }: CtaProps) {
  const benefits = [
    {
      icon: '✅',
      text: 'Sin permanencia',
    },
    {
      icon: '✅',
      text: 'Soporte en español',
    },
    {
      icon: '✅',
      text: 'Datos seguros en Europa',
    },
  ];

  return (
    <section id="probar" className="relative py-24 bg-[#1a365d] dark:bg-gray-900 overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 left-0 w-96 h-96 bg-[#ed8936] rounded-full blur-3xl transform -translate-x-1/2 -translate-y-1/2"></div>
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-[#ed8936] rounded-full blur-3xl transform translate-x-1/2 translate-y-1/2"></div>
      </div>

      <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          {/* Title */}
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-6">
            ¿Listo para trabajar con{' '}
            <span className="text-[#ed8936]">IA</span>?
          </h2>

          {/* Subtitle */}
          <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto">
            14 días gratis. Sin tarjeta de crédito. Cancela cuando quieras.
          </p>

          {/* CTA Button */}
          <div className="mb-10">
            {onOpenListaEspera ? (
              <button
                type="button"
                onClick={onOpenListaEspera}
                className="inline-flex items-center justify-center px-10 py-5 bg-[#ed8936] hover:bg-[#dd6b20] text-white text-lg font-bold rounded-lg transition-all duration-200 shadow-2xl hover:shadow-[0_20px_60px_rgba(237,137,54,0.4)] transform hover:scale-105"
              >
                Empezar ahora gratis
                <svg
                  className="ml-3 h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
              </button>
            ) : (
              <a
                href="#registro"
                className="inline-flex items-center justify-center px-10 py-5 bg-[#ed8936] hover:bg-[#dd6b20] text-white text-lg font-bold rounded-lg transition-all duration-200 shadow-2xl hover:shadow-[0_20px_60px_rgba(237,137,54,0.4)] transform hover:scale-105"
              >
                Empezar ahora gratis
                <svg
                  className="ml-3 h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
              </a>
            )}
          </div>

          {/* Benefits badges */}
          <div className="flex flex-wrap items-center justify-center gap-6">
            {benefits.map((benefit, index) => (
              <div
                key={index}
                className="inline-flex items-center space-x-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-5 py-2.5"
              >
                <span className="text-xl">{benefit.icon}</span>
                <span className="text-white font-semibold">{benefit.text}</span>
              </div>
            ))}
          </div>

          {/* Additional info */}
          <div className="mt-10 pt-10 border-t border-white/20">
            <p className="text-gray-400 text-sm">
              Sé de los primeros en transformar tu negocio con IA
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
