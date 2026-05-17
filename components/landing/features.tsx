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
    number: '01',
    icon: Mic,
    title: 'Presupuestos por voz',
    description:
      'Dicta las partidas como se las contarías a un compañero. PDF en 30 segundos.',
  },
  {
    number: '02',
    icon: Camera,
    title: 'Diario de obra',
    description: 'Foto + audio registrado con fecha y obra automáticamente.',
  },
  {
    number: '03',
    icon: Receipt,
    title: 'Control de gastos',
    description: 'OCR de tickets y albaranes directo desde el móvil.',
  },
  {
    number: '04',
    icon: Users,
    title: 'Gestión de operarios',
    description: 'Jornadas y horas por obra sin llamadas ni Excel.',
  },
  {
    number: '05',
    icon: CalendarClock,
    title: 'Agenda inteligente',
    description: 'Recordatorios con antelación automática para citas y visitas.',
  },
  {
    number: '06',
    icon: FolderKanban,
    title: 'Obras y clientes',
    description: 'Toda la documentación agrupada por obra en un solo lugar.',
  },
];

function FeatureRow({
  feature,
  index,
}: {
  feature: Feature;
  index: number;
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
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <article
      ref={ref}
      className={`flex items-start gap-6 py-6 border-b border-[#C8C4BB] transition-all duration-700 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
      }`}
      style={{ transitionDelay: visible ? `${index * 80}ms` : '0ms' }}
    >
      <span className="w-16 shrink-0 font-serif text-4xl text-accent leading-none">
        {feature.number}
      </span>
      <div className="flex-1 min-w-0">
        <h3 className="font-serif text-xl font-bold text-foreground">{feature.title}</h3>
        <p className="mt-2 font-mono text-sm text-[--muted-foreground] leading-relaxed">
          {feature.description}
        </p>
      </div>
      <Icon className="w-8 h-8 shrink-0 text-accent" strokeWidth={1.5} aria-hidden />
    </article>
  );
}

export function Features() {
  return (
    <section id="funcionalidades" className="py-24 bg-background border-b border-[#C8C4BB]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 max-w-3xl">
          <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-6 text-left">
            Todo lo que necesitas,{' '}
            <span className="text-accent">con IA que trabaja por ti</span>
          </h2>
          <p className="text-lg text-[--muted-foreground] font-mono">
            Herramienta de trabajo real para el día a día en obra
          </p>
        </div>

        <div>
          {features.map((feature, index) => (
            <FeatureRow key={feature.number} feature={feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}
