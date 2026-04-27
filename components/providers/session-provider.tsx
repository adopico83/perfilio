'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { getBusinessIdClient } from '@/lib/supabase/get-business-id';

type SessionContextValue = {
  user: User | null;
  businessId: string | null;
  loading: boolean;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export default function SessionProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const businessIdRef = useRef<string | null>(businessId);
  businessIdRef.current = businessId;

  useEffect(() => {
    let mounted = true;

    const loadSession = async () => {
      try {
        const {
          data: { user: currentUser },
        } = await supabase.auth.getUser();

        if (!mounted) return;
        setUser(currentUser ?? null);

        if (currentUser) {
          const bId = await getBusinessIdClient(supabase);
          if (!mounted) return;
          setBusinessId(bId);
        } else {
          setBusinessId(null);
        }
      } catch {
        if (mounted) {
          setUser(null);
          setBusinessId(null);
        }
      } finally {
        setLoading(false);
      }
    };

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      async (_event: AuthChangeEvent, session: Session | null) => {
        try {
          if (!mounted) return;
          const nextUser = session?.user ?? null;
          setUser(nextUser);

          if (nextUser) {
            if (businessIdRef.current !== null) {
              // Conservar businessId ya resuelto (p. ej. TOKEN_REFRESHED al volver el foco).
            } else {
              const bId = await getBusinessIdClient(supabase);
              if (!mounted) return;
              setBusinessId(bId);
            }
          } else {
            setBusinessId(null);
          }
        } catch {
          if (mounted) {
            setUser(null);
            setBusinessId(null);
          }
        } finally {
          setLoading(false);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const value = useMemo(
    () => ({ user, businessId, loading }),
    [user, businessId, loading]
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
