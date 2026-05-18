'use client';

import { useEffect, useRef, useState } from 'react';
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

const CELL_REVEAL_DELAYS = [50, 130, 220, 90, 180, 300] as const;

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
    'border-[#27272A]',
    index % 2 === 0 ? 'border-r' : '',
    index < 4 ? 'border-b' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function useRevealOnScroll(threshold = 0.15) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin: '0px 0px -40px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, visible };
}

function SectorCell({
  sector,
  index,
  sectionVisible,
}: {
  sector: Sector;
  index: number;
  sectionVisible: boolean;
}) {
  const Icon = sector.icon;
  const delay = CELL_REVEAL_DELAYS[index] ?? 150;

  return (
    <article
      className={`group flex flex-col px-8 py-10 transition-[opacity,transform,background-color] duration-700 ease-out hover:bg-white/[0.02] ${sectorCellBorder(index)}`}
      style={{
        opacity: sectionVisible ? 1 : 0,
        transform: sectionVisible ? 'translateY(0)' : 'translateY(15px)',
        transitionDelay: sectionVisible ? `${delay}ms` : '0ms',
      }}
    >
      <Icon
        className="h-6 w-6 text-[#A04A2F]"
        strokeWidth={1.5}
        aria-hidden
      />
      <h3 className="mt-5 font-serif text-xl text-[#F4F1EA] transition-colors duration-200 group-hover:text-white">
        {sector.title}
      </h3>
      <p className="mt-3 font-mono text-sm leading-relaxed text-[#6B6A65]">
        {sector.description}
      </p>
    </article>
  );
}

export function Sectors() {
  const { ref: sectionRef, visible: sectionVisible } = useRevealOnScroll(0.1);

  return (
    <section
      ref={sectionRef}
      id="sectores"
      className="bg-[#0D0D0F] py-24"
      style={{
        background:
          'radial-gradient(ellipse at center, rgba(160,74,47,0.08) 0%, #0D0D0F 70%)',
      }}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 max-w-3xl md:mb-20">
          <h2
            className="mb-6 text-left font-serif text-6xl text-[#F4F1EA] transition-[opacity,transform] duration-700 ease-out lg:text-7xl"
            style={{
              opacity: sectionVisible ? 1 : 0,
              transform: sectionVisible ? 'translateY(0)' : 'translateY(15px)',
            }}
          >
            Perfilio se adapta a{' '}
            <span className="text-[#A04A2F]">tu sector</span>
          </h2>
          <p
            className="font-mono text-sm text-[#6B6A65] transition-[opacity,transform] duration-700 ease-out"
            style={{
              opacity: sectionVisible ? 1 : 0,
              transform: sectionVisible ? 'translateY(0)' : 'translateY(15px)',
              transitionDelay: sectionVisible ? '90ms' : '0ms',
            }}
          >
            Soluciones específicas para cada tipo de negocio
          </p>
        </div>

        <div className="grid grid-cols-1 border border-[#27272A] sm:grid-cols-2">
          {sectors.map((sector, index) => (
            <SectorCell
              key={sector.title}
              sector={sector}
              index={index}
              sectionVisible={sectionVisible}
            />
          ))}
        </div>

        <div
          className="mt-16 text-center transition-[opacity,transform] duration-700 ease-out"
          style={{
            opacity: sectionVisible ? 1 : 0,
            transform: sectionVisible ? 'translateY(0)' : 'translateY(15px)',
            transitionDelay: sectionVisible ? '320ms' : '0ms',
          }}
        >
          <a
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center font-mono text-[#A04A2F] transition-colors hover:text-[#c25a3a]"
          >
            Háblanos de tu negocio →
          </a>
        </div>
      </div>
    </section>
  );
}
