'use client';

import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { getBusinessIdClient } from '@/lib/supabase/get-business-id';

type SessionContextValue = {
  user: User | null;
  businessId: string | null;
  loading: boolean;
};

type SessionState = {
  user: User | null;
  businessId: string | null;
  loading: boolean;
};

type SessionAction =
  | {
      type: 'SET_SESSION';
      payload: SessionState;
    }
  | { type: 'CLEAR_SESSION' };

const initialSessionState: SessionState = {
  user: null,
  businessId: null,
  loading: true,
};

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'SET_SESSION':
      return action.payload;
    case 'CLEAR_SESSION':
      return { user: null, businessId: null, loading: false };
    default:
      return state;
  }
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export default function SessionProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);

  useEffect(() => {
    let mounted = true;

    const loadSession = async () => {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();

      if (!mounted) return;
      const nextUser = currentUser ?? null;
      const bId = nextUser ? await getBusinessIdClient(supabase) : null;
      if (!mounted) return;
      dispatch({
        type: 'SET_SESSION',
        payload: {
          user: nextUser,
          businessId: bId,
          loading: false,
        },
      });
    };

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, session: Session | null) => {
        if (!mounted) return;
        if (event === 'SIGNED_OUT') {
          dispatch({ type: 'CLEAR_SESSION' });
          return;
        }
        const nextUser = session?.user ?? null;
        const bId = nextUser ? await getBusinessIdClient(supabase) : null;
        if (!mounted) return;
        dispatch({
          type: 'SET_SESSION',
          payload: {
            user: nextUser,
            businessId: bId,
            loading: false,
          },
        });
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const value = useMemo(
    () => ({ user: state.user, businessId: state.businessId, loading: state.loading }),
    [state]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession debe usarse dentro de SessionProvider');
  }
  return context;
}

export function SessionGate({ children }: { children: ReactNode }) {
  const { user, businessId, loading } = useSession();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const blocked = loading || (!!user && !businessId);

  useEffect(() => {
    if (!blocked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノマミムメモヤユヨラリルレロワヲン#$%&*+=<>!?';
    const fontSize = 18;
    let columns = 0;
    let drops: number[] = [];
    let rafId = 0;
    let frameCounter = 0;

    const setup = () => {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const width = window.innerWidth;
      const height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      columns = Math.max(1, Math.floor(width / fontSize));
      drops = Array.from({ length: columns }, () => Math.floor(Math.random() * -50));
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
    };

    const draw = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
      ctx.fillRect(0, 0, width, height);
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < columns; i += 1) {
        const text = chars[Math.floor(Math.random() * chars.length)] ?? '0';
        const x = i * fontSize;
        const y = drops[i] * fontSize;

        ctx.fillStyle = '#9affb7';
        ctx.fillText(text, x, y);
        ctx.fillStyle = '#00ff41';
        ctx.fillText(chars[Math.floor(Math.random() * chars.length)] ?? '1', x, y - fontSize);

        if (y > height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i] += 0.6;
      }
    };

    const loop = () => {
      frameCounter += 1;
      if (frameCounter % 2 === 0) {
        draw();
      }
      rafId = window.requestAnimationFrame(loop);
    };

    setup();
    loop();
    window.addEventListener('resize', setup);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', setup);
    };
  }, [blocked]);

  if (!blocked) return <>{children}</>;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="rounded-xl bg-black/60 px-6 py-5 text-center backdrop-blur-[1px]">
            <div className="mb-3 text-2xl font-bold tracking-[0.35em] text-white">PERFILIO</div>
            <div className="text-base font-medium text-[#ed8936]">
              Bicho esta preparando tu oficina
              <span className="inline-flex w-[1.6em] justify-start">
                <span className="matrix-dot matrix-dot-1">.</span>
                <span className="matrix-dot matrix-dot-2">.</span>
                <span className="matrix-dot matrix-dot-3">.</span>
              </span>
            </div>
          </div>
        </div>
      </div>
      <style jsx global>{`
        .matrix-dot {
          opacity: 0;
          animation: matrixDots 1.3s infinite;
        }
        .matrix-dot-2 {
          animation-delay: 0.2s;
        }
        .matrix-dot-3 {
          animation-delay: 0.4s;
        }
        @keyframes matrixDots {
          0%,
          20% {
            opacity: 0;
          }
          40%,
          100% {
            opacity: 1;
          }
        }
      `}</style>
    </>
  );
}
