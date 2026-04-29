'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

      setLoading(false);
    };

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, session: Session | null) => {
      if (!mounted) return;
      const nextUser = session?.user ?? null;
      setUser(nextUser);

      if (event === 'SIGNED_OUT') {
        setBusinessId(null);
        return;
      }

      if (event === 'TOKEN_REFRESHED') {
        if (businessIdRef.current !== null) {
          return;
        }
        if (nextUser) {
          const bId = await getBusinessIdClient(supabase);
          if (!mounted) return;
          setBusinessId(bId);
        }
        return;
      }

      if (event === 'SIGNED_IN' && nextUser && businessIdRef.current === null) {
        const bId = await getBusinessIdClient(supabase);
        if (!mounted) return;
        setBusinessId(bId);
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
