import {
  FileText,
  Receipt,
  Calendar,
  Package,
  BarChart3,
} from 'lucide-react';

const cards = [
  {
    icon: FileText,
    title: 'Presupuestos automáticos',
    description:
      'Genera presupuestos adaptados a tu sector en segundos',
  },
  {
    icon: Receipt,
    title: 'Facturas y albaranes',
    description:
      'Documentación administrativa sin esfuerzo',
  },
  {
    icon: Calendar,
    title: 'Gestión de agenda',
    description:
      'Citas, recordatorios y seguimiento de clientes',
  },
  {
    icon: Package,
    title: 'Control de inventario',
    description:
      'Stock actualizado y alertas automáticas',
  },
  {
    icon: BarChart3,
    title: 'Informes y métricas',
    description:
      'Conoce el rendimiento de tu negocio en tiempo real',
  },
];

export function AgentesSection() {
  return (
    <section className="relative py-20 bg-[#0f2744] overflow-hidden">
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <span className="inline-block px-4 py-1.5 rounded-full text-sm font-semibold text-[#ed8936] bg-[#ed8936]/15 mb-6">
            Próximamente
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">
            El agente IA que gestiona tu negocio
          </h2>
          <p className="text-lg sm:text-xl text-gray-300 max-w-2xl mx-auto">
            Automatización completa para PYMEs que quieren crecer
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-14">
          {cards.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="bg-white/5 border border-white/10 rounded-xl p-6 hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-[#ed8936]/20 text-[#ed8936] mb-4">
                <Icon className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                {description}
              </p>
            </div>
          ))}
        </div>

        <div className="text-center">
          <p className="text-xl text-white font-medium mb-4">
            ¿Quieres ser de los primeros?
          </p>
          <a
            href="#"
            className="inline-flex items-center justify-center px-8 py-3 rounded-lg font-semibold text-white bg-[#ed8936] hover:bg-[#dd6b20] transition-colors shadow-lg hover:shadow-xl"
          >
            Unirse a la lista de espera
          </a>
        </div>
      </div>
    </section>
  );
}
