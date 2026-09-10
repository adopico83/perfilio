import { Lock } from 'lucide-react';

/** Skyline del mock (PNG del crop embebido en SVG). Solo shell demo. */
export default function DemoSkyline() {
  return (
    <div className="mt-auto w-full px-3 pb-3 pt-6 select-none" data-testid="demo-skyline">
      <img
        src="/demo/skyline-errenteria.svg"
        alt=""
        width={276}
        height={237}
        className="block w-full h-auto pointer-events-none"
        draggable={false}
        aria-hidden
      />
      <p className="mt-1 flex items-center gap-1.5 text-[11px] leading-none text-[#C4A07A]">
        <Lock className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
        Datos seguros y privados
      </p>
    </div>
  );
}
