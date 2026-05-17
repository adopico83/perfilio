import type { LucideIcon } from 'lucide-react';
import {
  Hammer,
  Paintbrush,
  Sofa,
  Zap,
  Wrench,
  Building2,
} from 'lucide-react';

const WHATSAPP_HREF =
  'https://wa.me/34697613884?text=Hola%2C%20he%20visto%20Perfilio%20en%20vuestra%20web%20y%20me%20gustar%C3%ADa%20ver%20c%C3%B3mo%20funciona';

type Sector = {
  icon: LucideIcon;
  title: string;
  description: string;
};

const sectors: Sector[] = [
  {
    icon: Hammer,
    title: 'Albañilería',
    description: 'Presupuestos, albaranes y seguimiento de obra',
  },
  {
    icon: Paintbrush,
    title: 'Pintura y decoración',
    description: 'Partidas por voz, materiales y control de tiempos',
  },
  {
    icon: Sofa,
    title: 'Interiorismo',
    description: 'Presupuestos detallados y documentación por proyecto',
  },
  {
    icon: Zap,
    title: 'Electricistas',
    description: 'Obras, incidencias y jornadas organizadas en un solo sitio',
  },
  {
    icon: Wrench,
    title: 'Fontaneros',
    description: 'Control de partes, gastos y presupuestos sin Excel',
  },
  {
    icon: Building2,
    title: 'Reformas integrales',
    description: 'Todo el flujo de obra de principio a fin',
  },
];

function sectorCellBorder(index: number): string {
  return [
    'border-[#4A2C1A]',
    index % 2 === 0 ? 'border-r' : '',
    index < 4 ? 'border-b' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function Sectors() {
  return (
    <section id="sectores" className="py-24 bg-[#2C1810]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 md:mb-20 max-w-3xl">
          <h2 className="font-serif text-5xl font-bold text-[#F4F1EA] mb-6 text-left">
            Perfilio se adapta a{' '}
            <span className="text-accent">tu sector</span>
          </h2>
          <p className="text-lg text-[#A89070] font-mono">
            Soluciones específicas para cada tipo de negocio
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2">
          {sectors.map((sector, index) => {
            const Icon = sector.icon;
            return (
              <article
                key={sector.title}
                className={`flex flex-col p-8 sm:p-10 ${sectorCellBorder(index)}`}
              >
                <Icon className="h-6 w-6 text-accent" strokeWidth={1.5} aria-hidden />
                <h3 className="mt-5 font-serif text-xl font-bold text-[#F4F1EA]">
                  {sector.title}
                </h3>
                <p className="mt-3 font-mono text-sm leading-relaxed text-[#A89070]">
                  {sector.description}
                </p>
              </article>
            );
          })}
        </div>

        <div className="mt-16 text-center">
          <p className="text-lg text-[#A89070] mb-6 font-mono">
            ¿Tu gremio no aparece aquí? Te enseñamos cómo adaptamos Perfilio a tu trabajo.
          </p>
          <a
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center text-accent font-bold font-mono hover:text-[--brand-orange-hover] transition-colors"
          >
            Háblanos de tu negocio →
          </a>
        </div>
      </div>
    </section>
  );
}

