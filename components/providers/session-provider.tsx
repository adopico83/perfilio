'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { getBusinessIdClient } from '@/lib/supabase/get-business-id';

type SessionContextValue = {
  user: User | null;
  businessId: string | null;
  businessName: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  isInitialized: boolean;
  hasTimeoutError: boolean;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export default function SessionProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [hasTimeoutError, setHasTimeoutError] = useState(false);
  const businessIdRef = useRef<string | null>(null);
  businessIdRef.current = businessId;

  const loadBusinessName = async (bId: string | null): Promise<string> => {
    if (!bId) return '';
    const { data, error } = await supabase
      .from('business_profiles')
      .select('nombre')
      .eq('id', bId)
      .maybeSingle();
    if (error || !data?.nombre) return '';
    return data.nombre;
  };

  useEffect(() => {
    let mounted = true;
    const initTimeout = setTimeout(() => {
      if (!mounted) return;
      setIsInitialized(true);
      setLoading(false);
      if (businessIdRef.current === null) setHasTimeoutError(true);
    }, 4000);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, session: Session | null) => {
        try {
          if (!mounted) return;
          const nextUser = session?.user ?? null;
          setUser(nextUser);

          if (event === 'SIGNED_OUT' || !nextUser) {
            setBusinessId(null);
            businessIdRef.current = null;
            setBusinessName(null);
            setHasTimeoutError(false);
            return;
          }

          let bId = businessIdRef.current;
          if (bId === null) {
            bId = await getBusinessIdClient(supabase, nextUser.id);
            if (!mounted) return;
            setBusinessId(bId);
            businessIdRef.current = bId;
          }
          const bName = await loadBusinessName(bId);
          if (!mounted) return;
          setBusinessName(bName);
          setHasTimeoutError(false);
        } catch {
          if (!mounted) return;
          setBusinessName('');
        } finally {
          if (mounted) {
            setLoading(false);
            setIsInitialized(true);
          }
        }
      }
    );

    return () => {
      mounted = false;
      clearTimeout(initTimeout);
      subscription.unsubscribe();
    };
  }, [supabase]);

  const value = useMemo(
    () => ({
      user,
      businessId,
      businessName,
      loading,
      isAuthenticated: !loading && user !== null,
      isInitialized,
      hasTimeoutError,
    }),
    [user, businessId, businessName, loading, isInitialized, hasTimeoutError]
  );

  if (!isInitialized) return <div className="fixed inset-0 bg-[#0d1117]" />;

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession debe usarse dentro de SessionProvider');
  }
  return context;
}
