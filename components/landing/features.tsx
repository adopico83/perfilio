import { Bot, LayoutDashboard, FileText, Package, Receipt, MessageCircle } from 'lucide-react';

export function Features() {
  const features = [
    {
      number: '01',
      icon: Bot,
      title: 'Asistente IA 24/7',
      description:
        'Gestiona emails y WhatsApps automáticamente. Responde como tú, aprende de tu negocio.',
      color: '#60a5fa',
    },
    {
      number: '02',
      icon: LayoutDashboard,
      title: 'Dashboard Inteligente',
      description:
        'Vista centralizada de todo tu negocio. Priorización automática de tareas urgentes.',
      color: '#c084fc',
    },
    {
      number: '03',
      icon: FileText,
      title: 'Presupuestos Automáticos',
      description:
        'Genera presupuestos profesionales en minutos. PDF y envío directo al cliente.',
      color: '#fb923c',
    },
    {
      number: '04',
      icon: Package,
      title: 'Control de Stock',
      description:
        'Alertas cuando falta material. Nunca pares una obra por falta de stock.',
      color: '#4ade80',
    },
    {
      number: '05',
      icon: Receipt,
      title: 'Facturación Legal',
      description:
        'De presupuesto a factura en un clic. IVA, numeración y envío automático.',
      color: '#818cf8',
    },
    {
      number: '06',
      icon: MessageCircle,
      title: 'WhatsApp Business',
      description:
        'Envía presupuestos directos al móvil del cliente. Seguimiento automático.',
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
            Gestión empresarial completa con inteligencia artificial integrada
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
            href="#probar"
            className="inline-flex items-center justify-center px-8 py-4 bg-[#ed8936] hover:bg-[#dd6b20] text-white font-bold rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
          >
            Ver todas las funcionalidades
            <svg className="ml-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}
