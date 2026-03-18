'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type Tab = 'approved' | 'rejected';

interface HistorialItem {
  id: string;
  conversation_id: string;
  created_at: string;
  ai_response: string | null;
  edited_response: string | null;
  approved_at: string | null;
  rejected_at: string | null;
}

export default function HistorialPage() {
  const router = useRouter();
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  );

  const [tab, setTab] = useState<Tab>('approved');
  const [loading, setLoading] = useState(true);
  const [authChecking, setAuthChecking] = useState(true);
  const [approved, setApproved] = useState<HistorialItem[]>([]);
  const [rejected, setRejected] = useState<HistorialItem[]>([]);

  // Comprobar sesión (misma lógica que dashboard)
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      setAuthChecking(false);
    };
    checkAuth();
  }, [router, supabase]);

  const loadHistorial = async () => {
    const { data: approvedData } = await supabase
      .from('ai_responses')
      .select('id, conversation_id, created_at, ai_response, edited_response, approved_at, rejected_at')
      .not('approved_at', 'is', null)
      .order('created_at', { ascending: false });

    const { data: rejectedData } = await supabase
      .from('ai_responses')
      .select('id, conversation_id, created_at, ai_response, edited_response, approved_at, rejected_at')
      .not('rejected_at', 'is', null)
      .order('created_at', { ascending: false });

    setApproved((approvedData ?? []) as HistorialItem[]);
    setRejected((rejectedData ?? []) as HistorialItem[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!authChecking) loadHistorial();
  }, [authChecking]);

  const displayText = (item: HistorialItem) =>
    item.edited_response?.trim() ? item.edited_response : (item.ai_response ?? '');

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#1a365d] flex items-center justify-center">
        <p className="text-white">Comprobando sesión...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a365d] text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-white">Historial de mensajes</h1>
          <Link
            href="/dashboard"
            className="text-[#ed8936] hover:text-[#f6ad55] text-sm font-medium transition-colors"
          >
            ← Volver al dashboard
          </Link>
        </div>

        {/* Pestañas */}
        <div className="flex gap-2 mb-6 border-b border-white/20 pb-2">
          <button
            onClick={() => setTab('approved')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              tab === 'approved'
                ? 'bg-[#ed8936] text-white'
                : 'bg-white/10 text-white/80 hover:bg-white/20'
            }`}
          >
            Aprobados
          </button>
          <button
            onClick={() => setTab('rejected')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              tab === 'rejected'
                ? 'bg-[#ed8936] text-white'
                : 'bg-white/10 text-white/80 hover:bg-white/20'
            }`}
          >
            Rechazados
          </button>
        </div>

        {loading ? (
          <p className="text-white/70">Cargando...</p>
        ) : (
          <ul className="space-y-4">
            {(tab === 'approved' ? approved : rejected).map((item) => (
              <li
                key={item.id}
                className="bg-white/5 border border-white/10 rounded-lg p-4"
              >
                <div className="flex justify-between items-start gap-4 mb-2">
                  <span className="text-white/70 text-sm">
                    {new Date(item.created_at).toLocaleString('es-ES')}
                  </span>
                  <span
                    className={`inline-block px-3 py-1 text-xs font-semibold rounded-full shrink-0 ${
                      item.approved_at
                        ? 'bg-green-600/80 text-white'
                        : 'bg-red-600/80 text-white'
                    }`}
                  >
                    {item.approved_at ? 'Aprobado' : 'Rechazado'}
                  </span>
                </div>
                <p className="text-white/90 text-sm whitespace-pre-wrap">
                  {displayText(item)}
                </p>
              </li>
            ))}
          </ul>
        )}

        {!loading && (tab === 'approved' ? approved : rejected).length === 0 && (
          <p className="text-white/60 text-center py-8">
            No hay mensajes {tab === 'approved' ? 'aprobados' : 'rechazados'}.
          </p>
        )}
      </div>
    </div>
  );
}
