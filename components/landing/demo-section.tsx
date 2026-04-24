'use client';

import { Mic, Cog, FileText } from 'lucide-react';

const WHATSAPP_HREF =
  'https://wa.me/34697613884?text=Hola%2C%20he%20visto%20Perfilio%20en%20vuestra%20web%20y%20me%20gustar%C3%ADa%20ver%20c%C3%B3mo%20funciona';

export function DemoSection() {
  const pasos = [
    {
      icon: Mic,
      titulo: 'Hablas',
      texto: 'Dictas las partidas como se las contarias a un companero',
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
    <section className="relative py-24 bg-gradient-to-b from-[#1a365d] to-[#0f2744] dark:from-gray-900 dark:to-gray-950 overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-35"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1511818966892-d7d671e672a2?w=1600&q=80')",
        }}
      ></div>
      <div className="absolute inset-0 bg-[rgba(13,27,46,0.85)]"></div>
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-6">
            De voz a presupuesto en 30 segundos
          </h2>
          <p className="text-lg text-gray-300">
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
                className="bg-white/10 backdrop-blur-sm rounded-xl p-8 border border-white/20 shadow-lg"
              >
                <div className="w-14 h-14 rounded-xl bg-[#ed8936]/20 flex items-center justify-center mb-5">
                  <Icon className="w-7 h-7 text-[#ed8936]" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-3">{paso.titulo}</h3>
                <p className="text-gray-300 leading-relaxed">{paso.texto}</p>
              </article>
            );
          })}
        </div>

        {/* Bottom CTA */}
        <div className="mt-12 text-center">
          <a
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-10 py-5 bg-[#ed8936] hover:bg-[#dd6b20] text-white text-lg font-bold rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
          >
            Quiero una demo
          </a>
        </div>
      </div>
    </section>
  );
}
