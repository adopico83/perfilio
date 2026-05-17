'use client';

import { Mic, Cog, FileText } from 'lucide-react';

const WHATSAPP_HREF =
  'https://wa.me/34697613884?text=Hola%2C%20he%20visto%20Perfilio%20en%20vuestra%20web%20y%20me%20gustar%C3%ADa%20ver%20c%C3%B3mo%20funciona';

export function DemoSection() {
  const pasos = [
    {
      icon: Mic,
      titulo: 'Hablas',
      texto: 'Dictas las partidas como se las contarías a un compañero',
    },
    {
      icon: Cog,
      titulo: 'Tu agente procesa',
      texto: 'Busca precios, calcula mediciones y estructura el presupuesto',
    },
    {
      icon: FileText,
      titulo: 'PDF listo',
      texto: 'Presupuesto profesional con tu logo listo para enviar al cliente',
    },
  ];

  return (
    <section className="relative py-24 bg-background overflow-hidden border-y border-[--border]">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-20"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1511818966892-d7d671e672a2?w=1600&q=80')",
        }}
      />
      <div className="absolute inset-0 bg-background/88" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-6">
            De voz a presupuesto en 30 segundos
          </h2>
          <p className="text-lg text-[--muted-foreground]">
            Dicta las partidas de una obra y tu agente genera el presupuesto completo con precios, IVA
            y PDF listo para el cliente. Tu agente entiende el lenguaje del gremio: partidas, m2, ml, sacos,
            jornadas.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {pasos.map((paso) => {
            const Icon = paso.icon;
            return (
              <article
                key={paso.titulo}
                className="bg-[#EDE9E0] rounded-xl p-8 border border-[--border] shadow-lg"
              >
                <div className="w-14 h-14 rounded-xl bg-accent/15 flex items-center justify-center mb-5">
                  <Icon className="w-7 h-7 text-accent" />
                </div>
                <h3 className="font-serif text-2xl font-bold text-foreground mb-3">{paso.titulo}</h3>
                <p className="text-[--muted-foreground] leading-relaxed">{paso.texto}</p>
              </article>
            );
          })}
        </div>

        <div className="mt-12 text-center">
          <a
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-10 py-5 bg-accent hover:bg-[--brand-orange-hover] text-white text-lg font-bold rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
          >
            Quiero una demo
          </a>
        </div>
      </div>
    </section>
  );
}
