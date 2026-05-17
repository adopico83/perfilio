interface CtaProps {
  onOpenListaEspera?: () => void;
}

const WHATSAPP_HREF =
  'https://wa.me/34697613884?text=Hola%2C%20he%20visto%20Perfilio%20en%20vuestra%20web%20y%20me%20gustar%C3%ADa%20ver%20c%C3%B3mo%20funciona';

export function Cta(_: CtaProps) {
  const benefits = [
    {
      icon: '✅',
      text: 'Hecho en Euskadi',
    },
    {
      icon: '✅',
      text: 'Pensado para gremios',
    },
    {
      icon: '✅',
      text: 'Datos siempre seguros',
    },
  ];

  return (
    <section id="probar" className="relative py-24 bg-[#EDE9E0] overflow-hidden border-y border-[--border]">
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-0 left-0 w-96 h-96 bg-accent rounded-full blur-3xl transform -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-accent rounded-full blur-3xl transform translate-x-1/2 translate-y-1/2" />
      </div>

      <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-6">
            ¿Cuántas horas pierdes cada semana con el papeleo?
          </h2>

          <p className="text-xl text-[--muted-foreground] mb-8 max-w-2xl mx-auto">
            Tu agente se encarga. Tú a lo tuyo.
          </p>

          <div className="mb-10">
            <a
              href={WHATSAPP_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center px-10 py-5 bg-accent hover:bg-[--brand-orange-hover] text-white text-lg font-bold rounded-lg transition-all duration-200 shadow-2xl hover:shadow-xl"
            >
              Pedir demo gratis
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
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6">
            {benefits.map((benefit, index) => (
              <div
                key={index}
                className="inline-flex items-center space-x-2 bg-background border border-[--border] rounded-full px-5 py-2.5"
              >
                <span className="text-xl">{benefit.icon}</span>
                <span className="text-foreground font-semibold">{benefit.text}</span>
              </div>
            ))}
          </div>

          <div className="mt-10 pt-10 border-t border-[--border]">
            <p className="text-[--muted-foreground] text-sm">
              Beta activa con gremios reales
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
