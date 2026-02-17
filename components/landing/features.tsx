export function Features() {
  const features = [
    {
      icon: '🤖',
      title: 'Asistente IA 24/7',
      description:
        'Gestiona emails y WhatsApps automáticamente. Responde como tú, aprende de tu negocio.',
      gradient: 'from-blue-500 to-cyan-500',
    },
    {
      icon: '📊',
      title: 'Dashboard Inteligente',
      description:
        'Vista centralizada de todo tu negocio. Priorización automática de tareas urgentes.',
      gradient: 'from-purple-500 to-pink-500',
    },
    {
      icon: '📋',
      title: 'Presupuestos Automáticos',
      description:
        'Genera presupuestos profesionales en minutos. PDF y envío directo al cliente.',
      gradient: 'from-orange-500 to-red-500',
    },
    {
      icon: '📦',
      title: 'Control de Stock',
      description:
        'Alertas cuando falta material. Nunca pares una obra por falta de stock.',
      gradient: 'from-green-500 to-emerald-500',
    },
    {
      icon: '📄',
      title: 'Facturación Legal',
      description:
        'De presupuesto a factura en un clic. IVA, numeración y envío automático.',
      gradient: 'from-indigo-500 to-blue-500',
    },
    {
      icon: '💬',
      title: 'WhatsApp Business',
      description:
        'Envía presupuestos directos al móvil del cliente. Seguimiento automático.',
      gradient: 'from-teal-500 to-cyan-500',
    },
  ];

  return (
    <section id="funcionalidades" className="py-24 bg-white dark:bg-gray-900">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[#1a365d] dark:text-white mb-6">
            Todo lo que necesitas,{' '}
            <span className="text-[#ed8936]">con IA que trabaja por ti</span>
          </h2>
          <p className="text-lg text-[#4a5568] dark:text-gray-300">
            Gestión empresarial completa con inteligencia artificial integrada
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <div
              key={index}
              className="group relative bg-white dark:bg-gray-800 rounded-xl p-8 border border-gray-200 dark:border-gray-700 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-2"
            >
              {/* Gradient background on hover */}
              <div className="absolute inset-0 bg-gradient-to-br from-[#ed8936]/5 to-[#1a365d]/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

              {/* Content */}
              <div className="relative">
                {/* Icon */}
                <div className="mb-5">
                  <div className={`inline-flex items-center justify-center w-16 h-16 rounded-lg bg-gradient-to-br ${feature.gradient} shadow-lg`}>
                    <span className="text-3xl">{feature.icon}</span>
                  </div>
                </div>

                {/* Title */}
                <h3 className="text-xl font-bold text-[#1a365d] dark:text-white mb-3">
                  {feature.title}
                </h3>

                {/* Description */}
                <p className="text-[#4a5568] dark:text-gray-300 leading-relaxed">
                  {feature.description}
                </p>

                {/* Decorative line */}
                <div className={`mt-6 h-1 w-12 rounded-full bg-gradient-to-r ${feature.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`}></div>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="mt-16 text-center">
          <a
            href="#probar"
            className="inline-flex items-center justify-center px-8 py-4 bg-[#1a365d] hover:bg-[#2d4a7c] dark:bg-[#ed8936] dark:hover:bg-[#dd6b20] text-white font-bold rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
          >
            Ver todas las funcionalidades
            <svg
              className="ml-2 h-5 w-5"
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
      </div>
    </section>
  );
}
