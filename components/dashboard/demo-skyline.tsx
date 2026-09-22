import { Lock } from 'lucide-react';

/** Skyline recortado del mock (casas, torre y montaña). Solo shell demo. */
export default function DemoSkyline() {
  return (
    <div className="mt-auto w-full select-none pb-3 pt-4" data-testid="demo-skyline">
      <img
        src="/demo/skyline-errenteria.png?v=mock"
        alt=""
        width={224}
        height={120}
        className="block h-auto w-full pointer-events-none"
        draggable={false}
        aria-hidden
      />
      <p className="mt-1.5 flex items-center gap-1.5 px-4 text-[11px] leading-none text-[#C4A07A]">
        <Lock className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
        Datos seguros y privados
      </p>
    </div>
  );
}
