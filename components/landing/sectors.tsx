export function Sectors() {
  const sectors = [
    {
      name: 'TALLERES',
      subtitle: 'aluminio, madera, carpintería, mecánica',
      icon: (
        <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
          />
        </svg>
      ),
      description:
        'Presupuesta ventanas, gestiona stock de perfiles y programa instalaciones. Tu asistente avisa de urgencias mientras fabricas.',
      color: 'from-blue-600 to-cyan-600',
      bgColor: 'bg-blue-50 dark:bg-blue-900/10',
      borderColor: 'border-blue-200 dark:border-blue-800',
    },
    {
      name: 'SERVICIOS',
      subtitle: 'fontanería, electricidad, reformas, climatización',
      icon: (
        <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      ),
      description:
        'Gestiona obras, materiales y desplazamientos. Responde urgencias de clientes aunque estés en la obra.',
      color: 'from-orange-600 to-red-600',
      bgColor: 'bg-orange-50 dark:bg-orange-900/10',
      borderColor: 'border-orange-200 dark:border-orange-800',
    },
    {
      name: 'COMERCIOS',
      subtitle: 'tiendas, peluquerías, clínicas, restaurantes',
      icon: (
        <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
      ),
      description:
        'Citas, stock, clientes y comunicaciones. Tu negocio gestionado mientras atiendes en persona.',
      color: 'from-purple-600 to-pink-600',
      bgColor: 'bg-purple-50 dark:bg-purple-900/10',
      borderColor: 'border-purple-200 dark:border-purple-800',
    },
  ];

  return (
    <section id="sectores" className="py-24 bg-gray-50 dark:bg-gray-800">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[#1a365d] dark:text-white mb-6">
            Perfilio se adapta a{' '}
            <span className="text-[#ed8936]">tu sector</span>
          </h2>
          <p className="text-lg text-[#4a5568] dark:text-gray-300">
            Soluciones específicas para cada tipo de negocio
          </p>
        </div>

        {/* Sectors Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {sectors.map((sector, index) => (
            <div
              key={index}
              className={`group relative ${sector.bgColor} rounded-2xl p-8 border-2 ${sector.borderColor} shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-2`}
            >
              {/* Icon container */}
              <div className="mb-6">
                <div className={`inline-flex items-center justify-center w-20 h-20 rounded-xl bg-gradient-to-br ${sector.color} text-white shadow-lg transform group-hover:scale-110 transition-transform duration-300`}>
                  {sector.icon}
                </div>
              </div>

              {/* Title */}
              <h3 className="text-2xl font-bold text-[#1a365d] dark:text-white mb-2">
                {sector.name}
              </h3>

              {/* Subtitle */}
              <p className="text-sm font-medium text-[#4a5568] dark:text-gray-400 mb-4 uppercase tracking-wide">
                {sector.subtitle}
              </p>

              {/* Description */}
              <p className="text-[#4a5568] dark:text-gray-300 leading-relaxed text-base">
                {sector.description}
              </p>

              {/* Decorative gradient bar */}
              <div className={`mt-6 h-1 w-16 rounded-full bg-gradient-to-r ${sector.color} opacity-0 group-hover:opacity-100 transition-opacity duration-300`}></div>

              {/* Background decoration */}
              <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${sector.color} opacity-5 rounded-bl-full transform translate-x-8 -translate-y-8`}></div>
            </div>
          ))}
        </div>

        {/* Bottom text */}
        <div className="mt-16 text-center">
          <p className="text-lg text-[#4a5568] dark:text-gray-300 mb-6">
            ¿Tu sector no aparece aquí? Perfilio se adapta a cualquier PYME
          </p>
          <a
            href="#contacto"
            className="inline-flex items-center justify-center text-[#ed8936] font-bold hover:text-[#dd6b20] transition-colors"
          >
            Háblanos de tu negocio
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
