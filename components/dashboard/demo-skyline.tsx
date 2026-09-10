import { Lock } from 'lucide-react';

const STROKE = '#C4A07A';

function Window4({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} />
      <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} />
      <line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} />
    </g>
  );
}

function DoorSteps({ x, y, w }: { x: number; y: number; w: number }) {
  return (
    <g>
      <line x1={x - 2} y1={y} x2={x + w + 2} y2={y} />
      <line x1={x} y1={y + 3.5} x2={x + w} y2={y + 3.5} />
    </g>
  );
}

/** Line-art del mock (casas + torre + montaña). Solo shell demo. */
export default function DemoSkyline() {
  return (
    <div className="mt-auto w-full px-3 pb-3 pt-6 select-none" data-testid="demo-skyline">
      <svg
        viewBox="0 0 240 152"
        className="block w-full h-auto pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
        fill="none"
        stroke={STROKE}
        strokeWidth="1.35"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {/* Montaña de fondo */}
        <path d="M10 128 C 38 96, 58 56, 90 48 S 132 22, 170 26 S 214 72, 232 118" />

        {/* Casa izquierda (el muro derecho lo dibuja la torre) */}
        <path d="M20 142 V104 L34 88 V68 H42 V80 L56 66 L92 104" />
        <line x1="32" y1="68" x2="44" y2="68" />
        <Window4 x={30} y={108} w={14} h={16} />
        <Window4 x={62} y={108} w={14} h={16} />
        <rect x={50} y={122} width={12} height={20} rx="1" />
        <DoorSteps x={50} y={142} w={12} />

        {/* Torre / iglesia */}
        <path d="M92 142 V54 L122 20 L152 54 V142" />
        <rect x={104} y={58} width={10} height={11} />
        <rect x={126} y={58} width={10} height={11} />
        <Window4 x={102} y={78} w={14} h={16} />
        <Window4 x={124} y={78} w={14} h={16} />
        <Window4 x={102} y={104} w={14} h={18} />
        <Window4 x={124} y={104} w={14} h={18} />

        {/* Casa derecha (el muro izquierdo lo dibuja la torre) */}
        <path d="M152 100 L164 87 V68 H172 V79 L186 64 L220 100 V142" />
        <line x1="162" y1="68" x2="174" y2="68" />
        <Window4 x={160} y={108} w={14} h={16} />
        <rect x={190} y={122} width={12} height={20} rx="1" />
        <DoorSteps x={190} y={142} w={12} />
      </svg>
      <p className="mt-2 flex items-center gap-1.5 text-[11px] leading-none text-[#C4A07A]">
        <Lock className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
        Datos seguros y privados
      </p>
    </div>
  );
}
