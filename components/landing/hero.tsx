import React from 'react';

export default function Hero() {
  return (
    <section className="relative bg-[#09090B] text-[#F4F1EA] py-16 lg:py-24 overflow-hidden border-b border-[#27272a]/20">
      
      <div className="absolute top-0 inset-x-0 h-32 bg-[#1C1917] pointer-events-none z-0" />
      <div className="absolute top-32 inset-x-0 h-32 bg-gradient-to-b from-[#1C1917] to-[#09090B] pointer-events-none z-0" />

      <style dangerouslySetInnerHTML={{__html: `
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
        .animate-orbital-swing {
          transform-style: preserve-3d;
          animation: orbital-swing-3d 8s ease-in-out infinite;
          backface-visibility: hidden;
          will-change: transform;
        }
        .animate-glass-sweep {
          animation: reflection-sweep 8s ease-in-out infinite;
          will-change: transform;
        }
        .animate-marquee-flow {
          display: flex;
          width: max-content;
          animation: marquee-flow 25s linear infinite;
        }
        .chrome-specular-chassis {
          background: linear-gradient(135deg, #3a3940 0%, #0b0a0d 25%, #767580 45%, #08070a 65%, #2c2b30 100%);
          box-shadow: 
            inset 0 2px 3px rgba(255,255,255,0.6),
            inset 0 -2px 4px rgba(0,0,0,0.9),
            0 0 0 1px rgba(0,0,0,0.7),
            0 35px 80px rgba(0,0,0,0.95),
            0 0 120px 20px rgba(160,74,47,0.18);
        }
      `}} />

      <div className="w-full overflow-hidden bg-white py-4 border-b border-zinc-200 mb-16 select-none shadow-sm relative z-10">
        <div className="animate-marquee-flow text-[#A04A2F] font-mono text-xs font-bold uppercase tracking-[0.2em] whitespace-nowrap">
          <span>AGENTE ACTIVO → DICTADO RECIBIDO → PRESUPUESTO GENERADO → PDF LISTO → HACIENDA CONECTADA → OBRA REGISTRADA → FACTURA EMITIDA →&nbsp;</span>
          <span>AGENTE ACTIVO → DICTADO RECIBIDO → PRESUPUESTO GENERADO → PDF LISTO → HACIENDA CONECTADA → OBRA REGISTRADA → FACTURA EMITIDA →&nbsp;</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative z-10">
        
        <div className="flex flex-col items-start text-left space-y-8 order-2 lg:order-1">
          <h1 className="font-serif text-6xl sm:text-7xl lg:text-8xl font-normal tracking-tight leading-none text-white">
            El encargado que <br />
            <span className="text-[#A04A2F]">no duerme</span>
          </h1>
          
          <p className="font-sans text-lg text-[#A89070] max-w-sm font-light leading-relaxed">
            Tu agente gestiona presupuestos, obras, gastos y operarios mientras tú estás en faena.
          </p>

          <button className="bg-[#A04A2F] text-white font-mono text-xs uppercase tracking-widest px-8 py-5 rounded-none font-bold hover:translate-y-[-2px] transition-all duration-300 ease-out mt-4 border border-[#A04A2F] shadow-lg shadow-black/40">
            Agendar Demo Técnica →
          </button>
        </div>

        <div className="flex justify-center items-center lg:justify-end w-full order-1 lg:order-2 py-12 relative transform-gpu">
          
          <div className="absolute top-1/2 left-1/2 lg:left-2/3 -translate-x-1/2 -translate-y-1/2 w-[380px] h-[380px] bg-[#A04A2F]/10 blur-[110px] rounded-full pointer-events-none z-0" />

          <div className="relative z-10 mr-0 lg:mr-24" style={{ perspective: '2000px', transformStyle: 'preserve-3d' }}>
            
            <div className="animate-orbital-swing chrome-specular-chassis w-[285px] h-[580px] rounded-[3.2rem] p-[10px] relative border border-zinc-800/40">
              
              <div className="absolute inset-[1.5px] rounded-[3.1rem] border border-white/25 shadow-[inset_0_1px_2px_rgba(255,255,255,0.4)] pointer-events-none z-30" />
              
              <div className="absolute top-24 -left-[3px] w-[3px] h-7 bg-zinc-500 rounded-l-sm border-l border-white/30" />
              <div className="absolute top-36 -left-[3px] w-[3px] h-12 bg-zinc-500 rounded-l-sm border-l border-white/30" />
              <div className="absolute top-52 -left-[3px] w-[3px] h-12 bg-zinc-500 rounded-l-sm border-l border-white/30" />

              <div className="w-24 h-6 bg-black rounded-full absolute top-4 left-1/2 -translate-x-1/2 z-40 border border-white/10 shadow-inner" />

              <div className="w-full h-full rounded-[2.4rem] overflow-hidden bg-black relative z-10 border border-black/90 shadow-2xl" style={{ transformStyle: 'preserve-3d' }}>
                
                <div className="animate-glass-sweep absolute top-0 left-[-50%] w-[180%] h-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent pointer-events-none z-20" />
                <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.01] to-white/[0.06] pointer-events-none z-20 mix-blend-screen" />

                <div className="w-full h-full relative z-10 transform-gpu" style={{ transform: 'translateZ(1px)' }}>
                  <video 
                    src="/demo.mp4" 
                    autoPlay 
                    loop 
                    muted 
                    playsInline
                    preload="auto"
                    className="w-full h-full object-cover rounded-[2.4rem] scale-[1.01]"
                    style={{ backfaceVisibility: 'hidden' }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
