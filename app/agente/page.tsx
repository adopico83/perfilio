'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface BusinessProfile {
  id: string;
  nombre: string | null;
  sector: string | null;
}

type MessageRole = 'user' | 'assistant';

interface ChatMessage {
  role: MessageRole;
  content: string;
}

export default function AgentePage() {
  const router = useRouter();
  const [authChecking, setAuthChecking] = useState(true);
  const [businesses, setBusinesses] = useState<BusinessProfile[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [historial, setHistorial] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const checkAuth = async () => {
      const { createClient: createBrowserClient } = await import('@/lib/supabase/client');
      const client = createBrowserClient();
      const { data: { session } } = await client.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      setAuthChecking(false);
    };
    checkAuth();
  }, [router]);

  const loadBusinesses = async () => {
    const { data, error: e } = await supabase
      .from('business_profiles')
      .select('id, nombre, sector')
      .order('nombre');

    if (!e && data) {
      setBusinesses(data as BusinessProfile[]);
      if (data.length > 0 && !selectedId) setSelectedId(data[0].id);
    }
  };

  useEffect(() => {
    if (!authChecking) loadBusinesses();
  }, [authChecking]);

  const handleEnviar = async () => {
    if (!selectedId || !mensaje.trim()) {
      setError('Elige un negocio y escribe un mensaje.');
      return;
    }
    setError('');
    const texto = mensaje.trim();
    setMensaje('');
    setLoading(true);
    try {
      const res = await fetch('/api/agente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensaje: texto,
          business_id: selectedId,
          historial,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Error al llamar al agente');
        return;
      }
      const respuestaTexto = data.respuesta ?? '';
      setHistorial((prev) => [
        ...prev,
        { role: 'user', content: texto },
        { role: 'assistant', content: respuestaTexto },
      ]);
    } catch {
      setError('Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  const nuevaConversacion = () => {
    setHistorial([]);
    setError('');
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#1a365d] flex items-center justify-center">
        <p className="text-white">Comprobando sesión...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a365d] text-white p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold text-white">Prueba del agente IA</h1>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={nuevaConversacion}
              className="px-4 py-2 text-sm font-medium text-white/90 bg-white/10 hover:bg-white/20 rounded-lg transition-colors border border-white/20"
            >
              Nueva conversación
            </button>
            <Link
              href="/dashboard"
              className="text-[#ed8936] hover:text-[#f6ad55] text-sm font-medium transition-colors"
            >
              ← Volver al dashboard
            </Link>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          <label className="block text-sm font-medium text-white/90">
            Negocio
          </label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white focus:ring-2 focus:ring-[#ed8936] focus:border-[#ed8936] outline-none"
          >
            <option value="">Selecciona un negocio</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nombre ?? 'Sin nombre'} {b.sector ? `— ${b.sector}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-4 mb-6">
          <label className="block text-sm font-medium text-white/90">
            Mensaje
          </label>
          <textarea
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            placeholder="Escribe tu mensaje..."
            rows={4}
            className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/50 focus:ring-2 focus:ring-[#ed8936] focus:border-[#ed8936] outline-none resize-none"
            disabled={loading}
          />
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-500/20 border border-red-400/50 text-red-200 px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleEnviar}
          disabled={loading || !selectedId || !mensaje.trim()}
          className="w-full py-3.5 bg-[#ed8936] hover:bg-[#dd6b20] text-white font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Enviando...' : 'Enviar'}
        </button>

        {/* Historial del chat */}
        <div className="mt-8 space-y-4">
          {historial.map((msg, i) =>
            msg.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] px-4 py-3 rounded-xl rounded-br-md bg-[#ed8936] text-white">
                  <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div className="max-w-[85%] px-4 py-3 rounded-xl rounded-bl-md bg-[#0f2744] text-white border border-white/10">
                  <div className="text-sm leading-relaxed [&>*+*]:mt-2">
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => <p className="text-white">{children}</p>,
                        strong: ({ children }) => <strong className="text-[#ed8936] font-bold">{children}</strong>,
                        ul: ({ children }) => <ul className="list-disc pl-6 space-y-1 text-white">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-6 space-y-1 text-white">{children}</ol>,
                        li: ({ children }) => <li className="text-white">{children}</li>,
                        h1: ({ children }) => <h1 className="text-base font-bold text-white mt-2 mb-1">{children}</h1>,
                        h2: ({ children }) => <h2 className="text-sm font-bold text-white mt-2 mb-1">{children}</h2>,
                        h3: ({ children }) => <h3 className="text-sm font-bold text-white mt-1 mb-1">{children}</h3>,
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            )
          )}
        </div>

        {businesses.length === 0 && !authChecking && (
          <p className="mt-6 text-white/60 text-center text-sm">
            No hay perfiles de negocio. Crea registros en la tabla business_profiles.
          </p>
        )}
      </div>
    </div>
  );
}
