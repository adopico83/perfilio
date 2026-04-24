import { Hammer } from 'lucide-react';

export function Sectors() {
  const sectors = [
    {
      icon: 'hammer',
      iconComponent: Hammer,
      title: 'Albanileria',
      description: 'Presupuestos, albaranes y seguimiento de obra',
      image: 'https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?w=600&q=80',
    },
    {
      icon: '🎨',
      title: 'Pintura y decoracion',
      description: 'Partidas por voz, materiales y control de tiempos',
      image: 'https://images.unsplash.com/photo-1585704032915-c3400ca199e7?w=600&q=80',
    },
    {
      icon: '🛋️',
      title: 'Interiorismo',
      description: 'Presupuestos detallados y documentacion por proyecto',
      image: 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=600&q=80',
    },
    {
      icon: '⚡',
      title: 'Electricistas',
      description: 'Obras, incidencias y jornadas organizadas en un solo sitio',
      image: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=600&q=80',
    },
    {
      icon: '🚰',
      title: 'Fontaneros',
      description: 'Control de partes, gastos y presupuestos sin Excel',
      image: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=600&q=80',
    },
    {
      icon: '🏗️',
      title: 'Reformas integrales',
      description: 'Todo el flujo de obra de principio a fin',
      image: 'https://images.unsplash.com/photo-1541888946425-d81bb19240f5?w=600&q=80',
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
        {sectors.map((sector, index) => {
          const Icon = sector.iconComponent;
          return (
  <div
    key={index}
    className="group relative bg-white rounded-xl shadow-lg overflow-hidden hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2"
  >
    {/* Imagen de fondo */}
    <div 
      className="absolute inset-0 bg-cover bg-center opacity-20 group-hover:opacity-30 transition-opacity"
      style={{ backgroundImage: `url('${sector.image}')` }}
    ></div>
    <div className="absolute inset-0 bg-gradient-to-b from-transparent to-white"></div>
    
    {/* Contenido */}
    <div className="relative p-8">
      <div className="mb-4">
        {Icon ? <Icon className="w-12 h-12 text-[#1a365d]" /> : <span className="text-5xl">{sector.icon}</span>}
      </div>
      <h3 className="text-2xl font-bold text-gray-900 mb-3">
        {sector.title}
      </h3>
      <p className="text-gray-700">
        {sector.description}
      </p>
    </div>
  </div>
          );
        })}

        {/* Bottom text */}
        <div className="mt-16 text-center">
          <p className="text-lg text-[#4a5568] dark:text-gray-300 mb-6">
            ¿Tu gremio no aparece aqui? Te ensenamos como adaptamos Perfilio a tu trabajo.
          </p>
          <a
            href="https://wa.me/34697613884?text=Hola%2C%20he%20visto%20Perfilio%20en%20vuestra%20web%20y%20me%20gustar%C3%ADa%20ver%20c%C3%B3mo%20funciona"
            target="_blank"
            rel="noopener noreferrer"
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
      </div> 
    </section>
  );
}
