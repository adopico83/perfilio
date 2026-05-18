'use client';

import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Mic,
  Camera,
  Receipt,
  Users,
  CalendarClock,
  FolderKanban,
} from 'lucide-react';

type Feature = {
  number: string;
  icon: LucideIcon;
  title: string;
  description: string;
};

const features: Feature[] = [
  {
    number: '01.',
    icon: Mic,
    title: 'Presupuestos por voz',
    description:
      'Dicta las partidas como se las contarías a un compañero. PDF en 30 segundos.',
  },
  {
    number: '02.',
    icon: Camera,
    title: 'Diario de obra',
    description:
      'Foto + audio registrado automáticamente con fecha y obra. Sin Excel.',
  },
  {
    number: '03.',
    icon: Receipt,
    title: 'Control de gastos',
    description:
      'Escanea tickets con la cámara. El agente extrae proveedor, importe e IVA.',
  },
  {
    number: '04.',
    icon: Users,
    title: 'Gestión de operarios',
    description: 'Jornadas y horas por obra sin llamadas ni hojas de cálculo.',
  },
  {
    number: '05.',
    icon: CalendarClock,
    title: 'Agenda inteligente',
    description:
      'Recordatorios con antelación automática para citas y visitas.',
  },
  {
    number: '06.',
    icon: FolderKanban,
    title: 'Obras y clientes',
    description:
      'Toda la documentación agrupada por obra. Presupuestos, facturas, diario y gastos.',
  },
];

function DrawnLine({ visible }: { visible: boolean }) {
  return (
    <div className="h-px w-full overflow-hidden bg-transparent">
      <div
        className="h-px bg-[#C8C4BB] transition-[width] duration-[600ms] ease-out"
        style={{ width: visible ? '100%' : '0%' }}
        aria-hidden
      />
    </div>
  );
}

function FeatureRow({
  feature,
  index,
  isLast,
}: {
  feature: Feature;
  index: number;
  isLast: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const Icon = feature.icon;

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
      { threshold: 0.12, rootMargin: '0px 0px -48px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <article ref={ref} className="w-full">
      <DrawnLine visible={visible} />
      <div
        className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-12 transition-[opacity,transform] duration-700 ease-out sm:px-6 lg:flex-row lg:items-start lg:gap-0 lg:px-8"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(15px)',
          transitionDelay: visible ? `${index * 100}ms` : '0ms',
        }}
      >
        <div className="w-24 shrink-0 font-serif text-5xl leading-none text-[#A04A2F]">
          {feature.number}
        </div>
        <h3 className="w-full font-serif text-3xl font-medium text-[#1A1A1A] lg:w-1/3 lg:pr-8">
          {feature.title}
        </h3>
        <p className="flex-1 font-mono text-sm leading-relaxed text-[#6B6A65]">
          {feature.description}{' '}
          <Icon
            className="inline-block h-[1.1em] w-[1.1em] shrink-0 align-[-0.12em] text-[#A04A2F]"
            strokeWidth={1.5}
            aria-hidden
          />
        </p>
      </div>
      {isLast ? <DrawnLine visible={visible} /> : null}
    </article>
  );
}

export function Features() {
  return (
    <section id="funcionalidades" className="bg-[#EFEADF] py-24">
      <div className="w-full">
        {features.map((feature, index) => (
          <FeatureRow
            key={feature.number}
            feature={feature}
            index={index}
            isLast={index === features.length - 1}
          />
        ))}
      </div>
    </section>
  );
}
