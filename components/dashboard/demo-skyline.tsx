import { Lock } from 'lucide-react';

/** Skyline del mock (PNG 1:1). Solo shell demo. */
export default function DemoSkyline() {
  return (
    <div className="mt-auto w-full px-3 pb-3 pt-6 select-none" data-testid="demo-skyline">
      <img
        src="/demo/skyline-errenteria.png"
        alt=""
        width={960}
        height={574}
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
