'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  Hammer,
  Paintbrush,
  Sofa,
  Zap,
  Wrench,
  Building2,
} from 'lucide-react';
import { Header } from '@/components/landing/header';

const WHATSAPP_DEMO_HREF =
  'https://wa.me/34697613884?text=Hola%2C%20he%20visto%20Perfilio%20en%20vuestra%20web%20y%20me%20gustar%C3%ADa%20agendar%20una%20demo%20t%C3%A9cnica';

const SCENE_COUNT = 4;
const WHEEL_THRESHOLD = 72;
const SCENE_COOLDOWN_MS = 900;
const WHEEL_RESET_MS = 140;

const SCENE_CENTER = 'flex h-full w-full items-center justify-center';

const SCENE_GRID =
  'grid w-full max-w-7xl grid-cols-1 items-center gap-12 px-6 mx-auto lg:grid-cols-2';

const HERO_KEYFRAMES = `
  @keyframes orbital-swing-3d {
    0% { transform: perspective(2000px) rotateX(12deg) rotateY(-28deg) rotateZ(-6deg) translateX(-35px) translateY(0px); }
    50% { transform: perspective(2000px) rotateX(16deg) rotateY(22deg) rotateZ(5deg) translateX(35px) translateY(-20px); }
    100% { transform: perspective(2000px) rotateX(12deg) rotateY(-28deg) rotateZ(-6deg) translateX(-35px) translateY(0px); }
  }
  @keyframes reflection-sweep {
    0% { transform: translateX(-60%) rotate(35deg); }
    50% { transform: translateX(50%) rotate(35deg); }
    100% { transform: translateX(-60%) rotate(35deg); }
  }
  @keyframes marquee-flow {
    0% { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }
  .cartier-orbital {
    transform-style: preserve-3d;
    animation: orbital-swing-3d 8s ease-in-out infinite;
    backface-visibility: hidden;
    will-change: transform;
  }
  .cartier-glass-sweep {
    animation: reflection-sweep 8s ease-in-out infinite;
    will-change: transform;
  }
  .cartier-marquee {
    display: flex;
    width: max-content;
    animation: marquee-flow 25s linear infinite;
  }
  .cartier-chrome {
    background: linear-gradient(135deg, #3a3940 0%, #0b0a0d 25%, #767580 45%, #08070a 65%, #2c2b30 100%);
    box-shadow:
      inset 0 2px 3px rgba(255,255,255,0.6),
      inset 0 -2px 4px rgba(0,0,0,0.9),
      0 0 0 1px rgba(0,0,0,0.7),
      0 35px 80px rgba(0,0,0,0.95),
      0 0 120px 20px rgba(160,74,47,0.18);
  }
`;

const sceneSlide = {
  initial: { opacity: 0, scale: 0.96, y: 40 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 1, ease: 'easeOut' as const },
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    y: -20,
    transition: { duration: 0.6, ease: 'easeIn' as const },
  },
};

const BG_TRANSITION = { duration: 1.2, ease: 'easeInOut' as const };
const LIGHT_CONTENT_DELAY_S = 0.2;

const iphoneExit = {
  exit: {
    opacity: 0,
    scale: 0.5,
    rotateY: 90,
    transition: { duration: 0.65, ease: [0.4, 0, 0.2, 1] as const },
  },
};

const WORKFLOW_PHASES = [
  {
    id: '01',
    title: 'Dictado Directo',
    body: 'Hablas de forma natural a pie de obra, sin estructurar.',
  },
  {
    id: '02',
    title: 'Procesamiento de Ingeniería',
    body: 'El agente desglosa partidas, calcula metros lineales y busca precios de materiales.',
  },
  {
    id: '03',
    title: 'Automatización Documental',
    body: 'PDF bilingüe generado al instante y enviado directo a Hacienda.',
  },
] as const;

const SECTOR_VIDEO_SRC = '/sectores.mp4';

const FOLIO_EASE = [0.22, 1, 0.36, 1] as const;
const FOLIO_ENTER_S = 1;
const FOLIO_ROW_BASE_DELAY_S = 1.05;
const FOLIO_ROW_STAGGER_S = 0.5;

const MONITOR_LOG_LINE_MS = 200;

type MonitorLogLine = { text: string; isStatus?: boolean };
type NucleoVisualKind = 'brain' | 'hermes' | 'fiscal';

const NUCLEO_MONITOR_PROFILES: ReadonlyArray<{
  id: NucleoVisualKind;
  title: string;
  logs: readonly MonitorLogLine[];
}> = [
  {
    id: 'brain',
    title: 'BRAIN AGENT · PROCESANDO',
    logs: [
      { text: '[AUDIO_IN] Dictado de obra entrante...' },
      { text: '[PARSE] Detectadas 3 partidas, obra: Calle Mayor' },
      { text: '[BRAIN] Estructurando mediciones lineales...' },
      { text: '[STATUS] Procesamiento completado ✓', isStatus: true },
    ],
  },
  {
    id: 'hermes',
    title: 'HERMES SYSTEM · COMPILANDO',
    logs: [
      { text: '[DOC] Plantilla premium cargada...' },
      { text: '[CALC] Calculando bases imponibles e IVA...' },
      { text: '[PDF] Generando documento bilingüe...' },
      { text: '[STATUS] PDF listo para envío ✓', isStatus: true },
    ],
  },
  {
    id: 'fiscal',
    title: 'CONEXIÓN FISCAL · ACTIVA',
    logs: [
      { text: '[TBAI] Conectando con Hacienda...' },
      { text: '[CERT] Generando certificado digital...' },
      { text: '[SIGN] TicketBAI firmado · SHA256: a4f2e8...' },
      { text: '[STATUS] Estado: 200 OK ✓', isStatus: true },
    ],
  },
];

const AUDIO_BAR_COUNT = 20;
const AUDIO_BAR_MIN = 8;
const AUDIO_BAR_MAX = 48;

const BUDGET_ROWS = [
  {
    code: 'PA-001',
    concept: 'Carpintería aluminio anodizado',
    unit: 'm²',
    price: '185,00',
    total: '4.250,00 €',
  },
  {
    code: 'PA-002',
    concept: 'Solado porcelánico antideslizante',
    unit: 'm²',
    price: '42,00',
    total: '1.890,00 €',
  },
  {
    code: 'PA-003',
    concept: 'Demolición tabique interior',
    unit: 'm²',
    price: '18,00',
    total: '720,00 €',
  },
] as const;

const NUCLEO_ROWS = [
  {
    n: '01',
    title: 'Brain Agent',
    body: 'Automatización conversacional. Estructura partidas desde audio en bruto a pie de obra.',
  },
  {
    n: '02',
    title: 'Hermes System',
    body: 'Motor documental premium. Presupuestos bilingües listos para WhatsApp en segundos.',
  },
  {
    n: '03',
    title: 'Conexión Fiscal',
    body: 'Gestión directa con Hacienda en tiempo real. Cero Excels rotos.',
  },
] as const;

type SectorItem = { icon: LucideIcon; title: string; description: string };

const SECTORS: SectorItem[] = [
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

const CELL_DELAYS = [50, 130, 220, 90, 180, 300] as const;

function sectorCellBorder(index: number): string {
  return [
    'border-zinc-800',
    index % 3 !== 2 ? 'border-r' : '',
    index < 3 ? 'border-b' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function useLightBgReady(scene: number) {
  const [ready, setReady] = useState(scene === 2 || scene === 3);
  const prevRef = useRef(scene);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = scene;

    if (scene !== 2 && scene !== 3) {
      setReady(false);
      return;
    }

    const fromDark = prev === 1 || prev === 4;
    const waitMs = fromDark ? 520 : 200;
    setReady(false);
    const t = window.setTimeout(() => setReady(true), waitMs);
    return () => window.clearTimeout(t);
  }, [scene]);

  return ready;
}

function LightSceneContent({
  ready,
  children,
}: {
  ready: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className="h-full w-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: ready ? 1 : 0 }}
      transition={{
        delay: ready ? LIGHT_CONTENT_DELAY_S : 0,
        duration: 0.45,
        ease: 'easeOut',
      }}
    >
      {children}
    </motion.div>
  );
}

function useSceneWheel(
  currentScene: number,
  setCurrentScene: React.Dispatch<React.SetStateAction<number>>
) {
  const lockedRef = useRef(false);
  const accumRef = useRef(0);
  const lastChangeRef = useRef(0);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.min(SCENE_COUNT, Math.max(1, next));
      if (clamped === currentScene) return;

      const now = Date.now();
      if (lockedRef.current || now - lastChangeRef.current < SCENE_COOLDOWN_MS) {
        return;
      }

      lockedRef.current = true;
      lastChangeRef.current = now;
      accumRef.current = 0;
      setCurrentScene(clamped);

      window.setTimeout(() => {
        lockedRef.current = false;
      }, SCENE_COOLDOWN_MS);
    },
    [currentScene, setCurrentScene]
  );

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (lockedRef.current) return;

      accumRef.current += e.deltaY;
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => {
        accumRef.current = 0;
      }, WHEEL_RESET_MS);

      if (Math.abs(accumRef.current) < WHEEL_THRESHOLD) return;

      const direction = accumRef.current > 0 ? 1 : -1;
      accumRef.current = 0;
      goTo(currentScene + direction);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        goTo(currentScene + 1);
      }
      if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        goTo(currentScene - 1);
      }
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, [currentScene, goTo]);
}

function SceneIndicator({
  current,
  onSelect,
}: {
  current: number;
  onSelect: (n: number) => void;
}) {
  return (
    <nav
      className="pointer-events-auto fixed right-5 top-1/2 z-[60] flex -translate-y-1/2 flex-col gap-3 sm:right-8"
      aria-label="Escenas de la landing"
    >
      {Array.from({ length: SCENE_COUNT }, (_, i) => {
        const n = i + 1;
        const active = n === current;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onSelect(n)}
            aria-label={`Escena ${n}`}
            aria-current={active ? 'step' : undefined}
            className={`h-2 w-2 rounded-full transition-colors duration-300 ${
              active ? 'scale-125 bg-[#A04A2F]' : 'bg-zinc-600 hover:bg-zinc-500'
            }`}
          />
        );
      })}
    </nav>
  );
}

function DrawnLine({ delay = 0 }: { delay?: number }) {
  return (
    <div className="h-px w-full overflow-hidden">
      <motion.div
        className="h-px bg-[#C8C4BB]"
        initial={{ width: '0%' }}
        animate={{ width: '100%' }}
        transition={{ duration: 0.6, ease: 'easeOut', delay }}
      />
    </div>
  );
}

function EngineeringFolio({ active }: { active: boolean }) {
  const reduceMotion = useReducedMotion();
  const stamp = new Date().toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const folioEnter = active
    ? {
        x: 0,
        opacity: 1,
        y: reduceMotion ? 0 : [0, -6, 0],
      }
    : { x: 150, opacity: 0, y: 0 };

  const folioTransition = reduceMotion
    ? { duration: 0.35, ease: FOLIO_EASE }
    : {
        x: { duration: FOLIO_ENTER_S, ease: FOLIO_EASE },
        opacity: { duration: FOLIO_ENTER_S, ease: FOLIO_EASE },
        y: {
          duration: 4,
          repeat: Infinity,
          ease: 'easeInOut' as const,
          delay: FOLIO_ENTER_S,
        },
      };

  const blockReveal = (delay: number) =>
    active
      ? {
          opacity: 1,
          y: 0,
          transition: { duration: 0.4, delay, ease: FOLIO_EASE },
        }
      : { opacity: 0, y: 8 };

  return (
    <motion.div
      className="folio-sheet relative isolate mx-auto w-[420px] aspect-[1/1.41] shrink-0 overflow-hidden rounded-none border border-black/20 bg-white shadow-[0_30px_60px_rgba(0,0,0,0.14)] [color-scheme:light]"
      style={{
        color: '#000000',
        transform: 'perspective(1000px) rotateX(2deg) rotateY(-6deg)',
        transformStyle: 'preserve-3d',
      }}
      initial={{ x: 150, opacity: 0, y: 0 }}
      animate={folioEnter}
      transition={folioTransition}
    >
      <div className="flex h-full flex-col overflow-hidden p-5 font-mono text-[10px] text-zinc-950">
      <motion.header
        className="shrink-0 border-b border-black pb-3 text-zinc-950"
        initial={{ opacity: 0 }}
        animate={blockReveal(FOLIO_ROW_BASE_DELAY_S - 0.15)}
      >
        <p className="font-bold uppercase tracking-[0.18em]">
          PERFILIO TECHNOLOGIES · PRESUPUESTO #2026-047
        </p>
        <p className="mt-0.5">
          Obra: Reforma integral · Cliente: Confidencial
        </p>
      </motion.header>

      <motion.div
        className="mt-2 grid shrink-0 grid-cols-[40px_1fr_22px_44px_58px] gap-x-1 border-b border-black pb-1.5 font-semibold uppercase tracking-wider text-zinc-950"
        initial={{ opacity: 0 }}
        animate={blockReveal(FOLIO_ROW_BASE_DELAY_S - 0.05)}
      >
        <span>CÓDIGO</span>
        <span>CONCEPTO</span>
        <span>UD.</span>
        <span className="text-right">PRECIO</span>
        <span className="text-right">TOTAL</span>
      </motion.div>

      {BUDGET_ROWS.map((row, rowIndex) => (
        <motion.div
          key={row.code}
          className="grid grid-cols-[40px_1fr_22px_44px_58px] gap-x-1 border-b border-black py-1.5 text-zinc-950"
          initial={{ opacity: 0, y: 14 }}
          animate={
            active
              ? {
                  opacity: 1,
                  y: 0,
                  transition: {
                    duration: 0.5,
                    delay:
                      FOLIO_ROW_BASE_DELAY_S + rowIndex * FOLIO_ROW_STAGGER_S,
                    ease: FOLIO_EASE,
                  },
                }
              : { opacity: 0, y: 14 }
          }
        >
          <span className="font-semibold text-[#A04A2F]">{row.code}</span>
          <span className="leading-snug">{row.concept}</span>
          <span>{row.unit}</span>
          <span className="text-right tabular-nums">{row.price}</span>
          <span className="text-right tabular-nums font-bold">{row.total}</span>
        </motion.div>
      ))}

      <motion.div
        className="mt-2 flex shrink-0 justify-between border-t border-black pt-2 text-zinc-950"
        initial={{ opacity: 0, y: 14 }}
        animate={
          active
            ? {
                opacity: 1,
                y: 0,
                transition: {
                  duration: 0.5,
                  delay:
                    FOLIO_ROW_BASE_DELAY_S +
                    BUDGET_ROWS.length * FOLIO_ROW_STAGGER_S,
                  ease: FOLIO_EASE,
                },
              }
            : { opacity: 0, y: 14 }
        }
      >
        <span>Subtotal</span>
        <span className="tabular-nums font-medium">6.860,00 €</span>
      </motion.div>

      <motion.div
        className="flex shrink-0 justify-between text-zinc-950"
        initial={{ opacity: 0, y: 14 }}
        animate={
          active
            ? {
                opacity: 1,
                y: 0,
                transition: {
                  duration: 0.5,
                  delay:
                    FOLIO_ROW_BASE_DELAY_S +
                    (BUDGET_ROWS.length + 1) * FOLIO_ROW_STAGGER_S,
                  ease: FOLIO_EASE,
                },
              }
            : { opacity: 0, y: 14 }
        }
      >
        <span>IVA 21%</span>
        <span className="tabular-nums font-medium">1.440,60 €</span>
      </motion.div>

      <motion.div
        className="flex shrink-0 justify-between border-t border-black pt-1.5 font-bold text-zinc-950"
        initial={{ opacity: 0, y: 14 }}
        animate={
          active
            ? {
                opacity: 1,
                y: 0,
                transition: {
                  duration: 0.5,
                  delay:
                    FOLIO_ROW_BASE_DELAY_S +
                    (BUDGET_ROWS.length + 2) * FOLIO_ROW_STAGGER_S,
                  ease: FOLIO_EASE,
                },
              }
            : { opacity: 0, y: 14 }
        }
      >
        <span>TOTAL</span>
        <span className="tabular-nums">8.300,60 €</span>
      </motion.div>

      <motion.div
        className="mt-3 shrink-0 border border-black px-2 py-1.5"
        initial={{ opacity: 0, y: 14 }}
        animate={
          active
            ? {
                opacity: 1,
                y: 0,
                transition: {
                  duration: 0.5,
                  delay:
                    FOLIO_ROW_BASE_DELAY_S +
                    (BUDGET_ROWS.length + 3) * FOLIO_ROW_STAGGER_S,
                  ease: FOLIO_EASE,
                },
              }
            : { opacity: 0, y: 14 }
        }
      >
        <p className="font-bold uppercase tracking-widest text-[#A04A2F]">
          GENERADO POR PERFILIO
        </p>
        <p className="mt-0.5 text-zinc-950">{stamp}</p>
      </motion.div>
      </div>
    </motion.div>
  );
}

function useTypewriterLog(
  logs: readonly MonitorLogLine[],
  enabled: boolean,
  resetKey: number
) {
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    setVisibleCount(0);
    if (!enabled) return;

    const timers: number[] = [];
    logs.forEach((_, index) => {
      timers.push(
        window.setTimeout(() => {
          setVisibleCount(index + 1);
        }, index * MONITOR_LOG_LINE_MS)
      );
    });

    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [enabled, resetKey, logs]);

  return visibleCount;
}

function randomBarHeights() {
  return Array.from({ length: AUDIO_BAR_COUNT }, () =>
    Math.round(AUDIO_BAR_MIN + Math.random() * (AUDIO_BAR_MAX - AUDIO_BAR_MIN))
  );
}

function AudioWaveVisualizer() {
  const reduceMotion = useReducedMotion();
  const [heights, setHeights] = useState(randomBarHeights);

  useEffect(() => {
    if (reduceMotion) return;
    const id = window.setInterval(() => setHeights(randomBarHeights()), 300);
    return () => window.clearInterval(id);
  }, [reduceMotion]);

  return (
    <div
      className="flex h-14 w-full max-w-sm items-end justify-center gap-[3px]"
      aria-hidden
    >
      {heights.map((h, i) => (
        <motion.div
          key={i}
          className="w-1.5 rounded-sm bg-[#A04A2F]"
          animate={{ height: h }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          style={{ height: h }}
        />
      ))}
    </div>
  );
}

const HERMES_OVAL_CLASS =
  'rounded-full border border-zinc-300 bg-white px-4 py-2 font-mono text-[10px] text-zinc-800 shadow-sm whitespace-nowrap';

const HERMES_SVG_LINES = [
  { x2: 80, y2: 60 },
  { x2: 300, y2: 60 },
  { x2: 80, y2: 240 },
  { x2: 300, y2: 240 },
] as const;

function HermesTreeConnector() {
  return (
    <div className="flex justify-center">
      <div className="h-6 w-px bg-[#A04A2F]/30" />
    </div>
  );
}

function DocumentTreeVisualizer() {
  const reduceMotion = useReducedMotion();

  const rowMotion = (delay: number) => ({
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: {
      delay: reduceMotion ? 0 : delay,
      duration: 0.45,
      ease: FOLIO_EASE,
    },
  });

  return (
    <div
      className="relative flex w-full flex-1 flex-col justify-center overflow-hidden border border-zinc-200 bg-zinc-50/30 px-4 py-4"
      aria-hidden
    >
      <svg
        className="pointer-events-none absolute inset-0 z-0 h-full w-full"
        viewBox="0 0 400 300"
        aria-hidden
      >
        <defs>
          <marker
            id="hermes-arrow"
            markerWidth="6"
            markerHeight="6"
            refX="3"
            refY="3"
            orient="auto"
          >
            <path
              d="M0,0 L0,6 L6,3 z"
              fill="#A04A2F"
              fillOpacity="0.5"
            />
          </marker>
        </defs>
        {HERMES_SVG_LINES.map((target, index) => (
          <line
            key={index}
            x1={200}
            y1={150}
            x2={target.x2}
            y2={target.y2}
            stroke="#A04A2F"
            strokeWidth="1"
            strokeDasharray="5 3"
            strokeOpacity="0.45"
            markerEnd="url(#hermes-arrow)"
          />
        ))}
      </svg>

      <div className="relative z-10 flex flex-col">
        <motion.div className="mb-4 flex items-start justify-between gap-2" {...rowMotion(0)}>
          <div className={HERMES_OVAL_CLASS}>Dictado de Obra</div>
          <div className={`${HERMES_OVAL_CLASS} mr-2 shrink-0`}>
            Mermas Aluminio
          </div>
        </motion.div>

        <HermesTreeConnector />

        <motion.div className="my-4 flex justify-center" {...rowMotion(0.2)}>
          <div className="bg-[#A04A2F] px-6 py-3 font-mono text-xs text-white shadow-md">
            HERMES CORE
          </div>
        </motion.div>

        <HermesTreeConnector />

        <motion.div className="mt-4 flex items-start justify-between gap-2" {...rowMotion(0.4)}>
          <div className={HERMES_OVAL_CLASS}>Desglose IVA</div>
          <div className={`${HERMES_OVAL_CLASS} mr-2 shrink-0`}>
            TicketBAI Hash
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function FiscalCertificateVisualizer() {
  return (
    <motion.div
      className="w-full max-w-sm border border-[#A04A2F] bg-white/60 px-5 py-4"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-[#A04A2F]">
        TICKETBAI FIRMADO
      </p>
      <motion.p
        className="mt-3 font-mono text-[9px] text-zinc-600"
        animate={{ opacity: [1, 0.35, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        SHA256: a4f2e8c91b3d7f02e6a1c4b9d8e7f6a5
      </motion.p>
    </motion.div>
  );
}

function TelemetryVisual({ kind }: { kind: NucleoVisualKind }) {
  if (kind === 'brain') return <AudioWaveVisualizer />;
  if (kind === 'hermes') return <DocumentTreeVisualizer />;
  return <FiscalCertificateVisualizer />;
}

function MonitorTypewriterLogs({
  logs,
  enabled,
  resetKey,
  compact,
}: {
  logs: readonly MonitorLogLine[];
  enabled: boolean;
  resetKey: number;
  compact?: boolean;
}) {
  const visibleCount = useTypewriterLog(logs, enabled, resetKey);

  return (
    <ul
      className={
        compact
          ? 'mt-3 space-y-2 border-t border-[#C8C4BB]/80 pt-3'
          : 'mt-auto space-y-2 border-t border-[#C8C4BB]/80 pt-4'
      }
    >
      {logs.slice(0, visibleCount).map((line, i) => (
        <motion.li
          key={`${resetKey}-${i}-${line.text}`}
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2 }}
          className={line.isStatus ? 'text-[#A04A2F]' : 'text-zinc-600'}
        >
          {line.text}
        </motion.li>
      ))}
    </ul>
  );
}

function OperationsControlMonitor({
  active,
  activeIndex,
}: {
  active: boolean;
  activeIndex: number;
}) {
  const profile =
    NUCLEO_MONITOR_PROFILES[activeIndex] ?? NUCLEO_MONITOR_PROFILES[0];
  const isHermes = profile.id === 'hermes';

  return (
    <motion.div
      className={
        isHermes
          ? 'flex h-full min-h-[min(520px,72vh)] w-full max-w-xl [color-scheme:light]'
          : 'flex h-fit w-full max-w-xl self-start [color-scheme:light]'
      }
      initial={{ opacity: 0, y: 24 }}
      animate={active ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
      transition={{ duration: 0.65, ease: FOLIO_EASE }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={activeIndex}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className={
            isHermes
              ? 'flex h-full min-h-[min(520px,72vh)] w-full flex-col rounded-none border border-[#C8C4BB] bg-[#EFEADF] p-6 font-mono text-xs text-zinc-700'
              : 'flex h-fit w-full flex-col rounded-none border border-[#C8C4BB] bg-[#EFEADF] px-6 pt-6 pb-4 font-mono text-xs text-zinc-700'
          }
        >
          <p className="shrink-0 font-bold uppercase tracking-[0.2em] text-zinc-700">
            {profile.title}
          </p>
          <motion.div
            className={
              isHermes
                ? 'flex min-h-[min(300px,55vh)] flex-1 items-stretch justify-center py-2'
                : 'flex w-full items-center justify-center pt-1'
            }
          >
            <TelemetryVisual kind={profile.id} />
          </motion.div>
          <MonitorTypewriterLogs
            logs={profile.logs}
            enabled={active}
            resetKey={activeIndex}
            compact={!isHermes}
          />
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}


function SectorVideoFallback() {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center rounded-3xl border border-[#A04A2F]/20 bg-[#1C0E08] animate-pulse"
      aria-hidden
    >
      <p className="font-mono text-xs text-[#A04A2F]/40">
        SEÑAL DE OBRA · EN DIRECTO
      </p>
    </div>
  );
}

function SectorVideoPanel({ active }: { active: boolean }) {
  const [videoFailed, setVideoFailed] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  useEffect(() => {
    if (!active) {
      setVideoFailed(false);
      setVideoReady(false);
    }
  }, [active]);

  const showFallback = videoFailed || !videoReady;

  return (
    <motion.div
      className="relative h-[350px] w-full overflow-hidden rounded-3xl border border-zinc-800 shadow-[0_0_40px_rgba(0,0,0,0.6)] lg:h-[450px]"
      initial={{ opacity: 0, x: 20 }}
      animate={active ? { opacity: 1, x: 0 } : { opacity: 0, x: 20 }}
      transition={{ duration: 0.75, ease: FOLIO_EASE, delay: 0.08 }}
    >
      {videoFailed ? (
        <SectorVideoFallback />
      ) : (
        <>
          <video
            src={SECTOR_VIDEO_SRC}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            onError={() => {
              setVideoReady(false);
              setVideoFailed(true);
            }}
            onLoadedData={() => setVideoReady(true)}
            onCanPlay={() => setVideoReady(true)}
            className={`absolute inset-0 h-full w-full rounded-3xl object-cover transition-opacity duration-700 ${
              videoReady ? 'opacity-85 contrast-110' : 'opacity-0'
            }`}
          />
          {showFallback ? <SectorVideoFallback /> : null}
        </>
      )}
      {videoReady && !videoFailed ? (
        <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-t from-[#0D0D0F]/40 via-transparent to-transparent" />
      ) : null}
    </motion.div>
  );
}


function SceneMonolith() {
  const [panelActive, setPanelActive] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setPanelActive(true), 120);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex h-screen w-full flex-col items-center justify-center overflow-hidden bg-[#0D0D0F] px-6 lg:px-16"
      variants={sceneSlide}
      initial="initial"
      animate="animate"
      exit="exit"
    >
        <motion.div
          className="grid w-full max-w-7xl grid-cols-1 items-center gap-12 lg:grid-cols-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <motion.div
            className="flex flex-col"
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.65, ease: FOLIO_EASE }}
          >
            <h2 className="max-w-xl font-serif text-4xl leading-[1.08] text-[#F4F1EA] sm:text-5xl lg:text-[3.25rem]">
              Perfilio se adapta a{' '}
              <span className="text-[#A04A2F]">tu sector</span>
            </h2>
            <p className="mt-3 max-w-md font-mono text-sm leading-relaxed text-[#F4F1EA]/85">
              Soluciones específicas para cada tipo de negocio
            </p>

            <motion.div
              className="mt-8 grid grid-cols-1 border border-zinc-800 bg-[#0D0D0F]/80 backdrop-blur-sm sm:grid-cols-3"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.15, ease: FOLIO_EASE }}
            >
              {SECTORS.map((sector, index) => {
                const Icon = sector.icon;
                const delay = (CELL_DELAYS[index] ?? 150) / 1000;
                return (
                  <motion.article
                    key={sector.title}
                    className={`group flex flex-col px-5 py-6 transition-colors hover:bg-white/[0.04] sm:px-6 sm:py-7 ${sectorCellBorder(index)}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, delay: 0.2 + delay, ease: FOLIO_EASE }}
                  >
                    <Icon
                      className="h-5 w-5 text-[#A04A2F]"
                      strokeWidth={1.5}
                      aria-hidden
                    />
                    <h3 className="mt-3 font-serif text-base text-[#F4F1EA] transition-colors group-hover:text-white sm:text-lg">
                      {sector.title}
                    </h3>
                    <p className="mt-2 font-mono text-[11px] leading-relaxed text-[#F4F1EA]/80 sm:text-xs">
                      {sector.description}
                    </p>
                  </motion.article>
                );
              })}
            </motion.div>

            <motion.div
              className="mt-6 flex justify-start"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4, ease: FOLIO_EASE }}
            >
              <a
                href={WHATSAPP_DEMO_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-none border border-[#A04A2F] bg-[#A04A2F] px-10 py-4 font-mono text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-[#8a3d28]"
              >
                Agendar Demo Técnica →
              </a>
            </motion.div>
          </motion.div>

          <div className="w-full">
            <SectorVideoPanel active={panelActive} />
          </div>
        </motion.div>
    </motion.div>
  );
}

function SceneHero() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col pt-16 sm:pt-20"
      variants={sceneSlide}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute top-0 inset-x-0 h-32 bg-[#1C1917]" />
        <div className="absolute top-32 inset-x-0 h-32 bg-gradient-to-b from-[#1C1917] to-[#09090B]" />
      </div>

      <style dangerouslySetInnerHTML={{ __html: HERO_KEYFRAMES }} />

      <motion.div
        className="relative z-10 w-full shrink-0 overflow-hidden border-b border-zinc-200 bg-white py-3 select-none"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.5 }}
      >
        <div className="cartier-marquee font-mono text-xs font-bold uppercase tracking-[0.2em] text-[#A04A2F] whitespace-nowrap">
          <span>
            AGENTE ACTIVO → DICTADO RECIBIDO → PRESUPUESTO GENERADO → PDF LISTO →
            HACIENDA CONECTADA → OBRA REGISTRADA → FACTURA EMITIDA →&nbsp;
          </span>
          <span>
            AGENTE ACTIVO → DICTADO RECIBIDO → PRESUPUESTO GENERADO → PDF LISTO →
            HACIENDA CONECTADA → OBRA REGISTRADA → FACTURA EMITIDA →&nbsp;
          </span>
        </div>
      </motion.div>

      <div className={`${SCENE_CENTER} relative z-10 min-h-0 flex-1`}>
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-center gap-8 px-6 lg:flex-row lg:items-center lg:gap-12">
          <motion.div
          className="order-2 flex w-full max-w-xl flex-col items-start space-y-6 text-left lg:order-1"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45 }}
        >
          <h1 className="font-serif text-5xl font-normal leading-none tracking-tight text-white sm:text-6xl lg:text-7xl xl:text-8xl">
            El encargado que <br />
            <span className="text-[#A04A2F]">no duerme</span>
          </h1>
          <p className="max-w-sm font-sans text-lg font-light leading-relaxed text-[#F4F1EA]">
            Tu agente gestiona presupuestos, obras, gastos y operarios mientras tú
            estás en faena.
          </p>
          <a
            href={WHATSAPP_DEMO_HREF}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex rounded-none border border-[#A04A2F] bg-[#A04A2F] px-8 py-5 font-mono text-xs font-bold uppercase tracking-widest text-white transition-transform duration-300 ease-out hover:-translate-y-0.5"
          >
            Agendar Demo Técnica →
          </a>
        </motion.div>

        <motion.div
          className="order-1 flex w-full justify-center py-2 lg:order-2 lg:justify-end lg:pr-8"
          style={{ transformStyle: 'preserve-3d' }}
          variants={iphoneExit}
          exit="exit"
        >
          <div
            className="relative flex justify-center"
            style={{ perspective: '2000px', transformStyle: 'preserve-3d' }}
          >
            <div className="absolute top-1/2 left-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#A04A2F]/10 blur-[100px] lg:left-2/3" />

            <div
              className="cartier-orbital cartier-chrome relative h-[min(68vh,520px)] w-[240px] rounded-[2.8rem] border border-zinc-800/40 p-[10px] sm:h-[560px] sm:w-[265px] lg:h-[580px] lg:w-[285px] lg:rounded-[3.2rem]"
              style={{ transformStyle: 'preserve-3d' }}
            >
              <div className="pointer-events-none absolute inset-[1.5px] z-30 rounded-[2.7rem] border border-white/25 shadow-[inset_0_1px_2px_rgba(255,255,255,0.4)] lg:rounded-[3.1rem]" />
              <div className="absolute top-24 -left-[3px] h-7 w-[3px] rounded-l-sm border-l border-white/30 bg-zinc-500" />
              <div className="absolute top-36 -left-[3px] h-12 w-[3px] rounded-l-sm border-l border-white/30 bg-zinc-500" />
              <div className="absolute top-52 -left-[3px] h-12 w-[3px] rounded-l-sm border-l border-white/30 bg-zinc-500" />
              <div className="absolute top-4 left-1/2 z-40 h-6 w-20 -translate-x-1/2 rounded-full border border-white/10 bg-black shadow-inner" />

              <div
                className="relative z-10 h-full w-full overflow-hidden rounded-[2.1rem] border border-black/90 bg-black lg:rounded-[2.4rem]"
                style={{ transformStyle: 'preserve-3d' }}
              >
                <div className="cartier-glass-sweep pointer-events-none absolute top-0 left-[-50%] z-20 h-full w-[180%] bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
                <div className="pointer-events-none absolute inset-0 z-20 bg-gradient-to-tr from-transparent via-white/[0.01] to-white/[0.06] mix-blend-screen" />
                <div
                  className="relative z-10 h-full w-full"
                  style={{ transform: 'translateZ(1px)' }}
                >
                  <video
                    src="/demo.mp4"
                    autoPlay
                    loop
                    muted
                    playsInline
                    preload="auto"
                    className="h-full w-full scale-[1.01] object-cover rounded-[2.1rem] lg:rounded-[2.4rem]"
                  />
                </div>
              </div>
            </div>
          </div>
        </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

function SceneWorkflow({ lightReady }: { lightReady: boolean }) {
  const [folioActive, setFolioActive] = useState(false);

  useEffect(() => {
    if (!lightReady) {
      setFolioActive(false);
      return;
    }
    const t = window.setTimeout(() => setFolioActive(true), 400);
    return () => window.clearTimeout(t);
  }, [lightReady]);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center overflow-hidden pt-16 sm:pt-20"
      variants={sceneSlide}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <LightSceneContent ready={lightReady}>
        <div className={`${SCENE_CENTER} min-h-full py-8`}>
          <div className={SCENE_GRID}>
            <div>
            <p className="font-serif text-3xl font-normal leading-[1.12] text-[#1A1A1A] sm:text-4xl lg:text-[2.75rem]">
              Perfilio no es un software de gestión. Es un sistema operativo
              agéntico.
            </p>

            <div className="mt-10 space-y-8">
              {WORKFLOW_PHASES.map((phase, i) => (
                <div key={phase.id}>
                  {i > 0 ? <DrawnLine delay={0.1 * i} /> : null}
                  <div className={i > 0 ? 'pt-8' : ''}>
                    <p className="font-mono text-sm font-medium text-[#1A1A1A]">
                      <span className="text-[#A04A2F]">{phase.id}.</span>{' '}
                      {phase.title}
                    </p>
                    <p className="mt-2 font-mono text-sm leading-relaxed text-[#1A1A1A]">
                      {phase.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-center lg:justify-end">
            <EngineeringFolio active={folioActive} />
          </div>
          </div>
        </div>
      </LightSceneContent>
    </motion.div>
  );
}

function SceneNucleo({ lightReady }: { lightReady: boolean }) {
  const [activeRow, setActiveRow] = useState(0);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center overflow-hidden pt-16 sm:pt-20"
      variants={sceneSlide}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <LightSceneContent ready={lightReady}>
        <div className={`${SCENE_CENTER} min-h-full py-8`}>
          <div className={SCENE_GRID}>
            <div>
            {NUCLEO_ROWS.map((row, index) => {
              const isLast = index === NUCLEO_ROWS.length - 1;
              const isActive = activeRow === index;
              return (
                <article
                  key={row.n}
                  className={`cursor-pointer transition-colors ${isActive ? 'bg-black/[0.03]' : ''}`}
                  onMouseEnter={() => setActiveRow(index)}
                  onFocus={() => setActiveRow(index)}
                  tabIndex={0}
                >
                  <DrawnLine delay={index * 0.08} />
                  <div className="flex flex-col gap-4 py-8 lg:flex-row lg:items-start lg:gap-6">
                    <div className="w-16 shrink-0 font-serif text-5xl leading-none text-[#A04A2F]">
                      {row.n}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3
                        className={`font-serif text-2xl font-medium lg:text-3xl ${
                          isActive ? 'text-[#A04A2F]' : 'text-[#1A1A1A]'
                        }`}
                      >
                        {row.title}
                      </h3>
                      <p className="mt-2 font-mono text-sm leading-relaxed text-[#1A1A1A]">
                        {row.body}
                      </p>
                    </div>
                  </div>
                  {isLast ? <DrawnLine delay={0.3} /> : null}
                </article>
              );
            })}
          </div>

          <div className="flex h-full min-h-0 w-full items-stretch lg:justify-end">
            <OperationsControlMonitor active={lightReady} activeIndex={activeRow} />
          </div>
        </div>
      </div>
      </LightSceneContent>
    </motion.div>
  );
}

export default function Home() {
  const [currentScene, setCurrentScene] = useState(1);
  const lightReady = useLightBgReady(currentScene);
  const reduceMotion = useReducedMotion();
  const lockedNavRef = useRef(false);

  useSceneWheel(currentScene, setCurrentScene);

  const goToScene = useCallback((n: number) => {
    const clamped = Math.min(SCENE_COUNT, Math.max(1, n));
    if (lockedNavRef.current) return;
    lockedNavRef.current = true;
    setCurrentScene(clamped);
    window.setTimeout(() => {
      lockedNavRef.current = false;
    }, SCENE_COOLDOWN_MS);
  }, []);

  const bg =
    currentScene === 1
      ? '#09090B'
      : currentScene === 4
        ? '#0D0D0F'
        : '#EFEADF';

  return (
    <motion.div
      data-theme="light"
      className="fixed inset-0 h-screen w-full overflow-hidden bg-[#09090B]"
    >
      <motion.div
        className="pointer-events-none absolute inset-0 z-0"
        animate={{ backgroundColor: bg }}
        transition={BG_TRANSITION}
      />

      <div className="pointer-events-none fixed inset-x-0 top-0 z-50">
        <div className="pointer-events-auto">
          <Header />
        </div>
      </div>

      <SceneIndicator current={currentScene} onSelect={goToScene} />

      <main
        className="relative z-10 h-full w-full"
        style={{ perspective: reduceMotion ? undefined : '1200px' }}
      >
        <AnimatePresence mode="wait">
          {currentScene === 1 && <SceneHero key="hero" />}
          {currentScene === 2 && (
            <SceneWorkflow key="workflow" lightReady={lightReady} />
          )}
          {currentScene === 3 && (
            <SceneNucleo key="nucleo" lightReady={lightReady} />
          )}
          {currentScene === 4 && <SceneMonolith key="monolith" />}
        </AnimatePresence>
      </main>
    </motion.div>
  );
}
