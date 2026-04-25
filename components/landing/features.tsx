import { Mic, Camera, Receipt, Users, CalendarClock, FolderKanban } from 'lucide-react';

const WHATSAPP_HREF =
  'https://wa.me/34697613884?text=Hola%2C%20he%20visto%20Perfilio%20en%20vuestra%20web%20y%20me%20gustar%C3%ADa%20ver%20c%C3%B3mo%20funciona';

export function Features() {
  const features = [
    {
      number: '01',
      icon: Mic,
      title: 'Presupuestos por voz',
      description:
        'Dicta partidas y tu agente genera el presupuesto completo con PDF.',
      color: '#60a5fa',
    },
    {
      number: '02',
      icon: Camera,
      title: 'Diario de obra',
      description:
        'Foto + audio y queda registrado con fecha y obra automáticamente.',
      color: '#c084fc',
    },
    {
      number: '03',
      icon: Receipt,
      title: 'Control de gastos',
      description:
        'OCR de tickets y albaranes directo desde el móvil.',
      color: '#fb923c',
    },
    {
      number: '04',
      icon: Users,
      title: 'Gestión de operarios',
      description:
        'Registra jornadas y horas por obra sin llamadas ni Excel.',
      color: '#4ade80',
    },
    {
      number: '05',
      icon: CalendarClock,
      title: 'Agenda inteligente',
      description:
        'Recordatorios con antelación automática para citas y visitas.',
      color: '#818cf8',
    },
    {
      number: '06',
      icon: FolderKanban,
      title: 'Obras y clientes',
      description:
        'Toda la documentación agrupada por obra en un solo lugar.',
      color: '#2dd4bf',
    },
  ];

  return (
    <section id="funcionalidades" className="py-24 relative overflow-hidden">

      {/* Foto de fondo — oficina moderna */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage:
            'url(https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600&q=80)',
        }}
      />

      {/* Gradiente oscuro encima */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0f1f3d]/92 via-[#0f1f3d]/88 to-[#0f1f3d]/95" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-20">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-6">
            Todo lo que necesitas,{' '}
            <span className="text-[#ed8936]">con IA que trabaja por ti</span>
          </h2>
          <p className="text-lg text-gray-300">
            Herramienta de trabajo real para el día a día en obra
          </p>
        </div>

        {/* Timeline Grid */}
        <div className="relative">

          {/* Línea conectora horizontal (solo desktop) */}
          <div className="hidden lg:block absolute top-8 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#ed8936]/40 to-transparent" />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-16">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <div key={index} className="group relative flex flex-col">

                  {/* Número + Icono */}
                  <div className="flex items-center gap-5 mb-6">
                    <div className="relative flex-shrink-0">
                      <span className="text-5xl font-black text-[#ed8936]/20 select-none leading-none">
                        {feature.number}
                      </span>
                      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-[#ed8936] border-2 border-[#0f1f3d] shadow-sm hidden lg:block" />
                    </div>

                    <div className="group-hover:scale-110 transition-transform duration-300">
                      <Icon
                        className="w-8 h-8"
                        style={{ color: feature.color }}
                        strokeWidth={1.5}
                      />
                    </div>
                  </div>

                  {/* Contenido */}
                  <div>
                    <h3 className="text-xl font-bold text-white mb-3 group-hover:text-[#ed8936] transition-colors duration-300">
                      {feature.title}
                    </h3>
                    <p className="text-gray-400 leading-relaxed text-sm">
                      {feature.description}
                    </p>
                    <div
                      className="mt-5 h-[2px] w-0 group-hover:w-10 rounded-full transition-all duration-500"
                      style={{ backgroundColor: feature.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="mt-20 text-center">
          <a
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-10 py-5 bg-[#ed8936] hover:bg-[#dd6b20] text-white text-lg font-bold rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
          >
            Pedir demo
            <svg className="ml-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}
