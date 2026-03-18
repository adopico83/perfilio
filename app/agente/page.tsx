'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';

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

interface PendingMessage {
  conv: any;
  aiResponse: any | null;
}

export default function AgentePage() {
  const router = useRouter();
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  );

  const [authChecking, setAuthChecking] = useState(true);
  const [businesses, setBusinesses] = useState<BusinessProfile[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [historial, setHistorial] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [currentPendingIndex, setCurrentPendingIndex] = useState(0);
  const [pendingEditingId, setPendingEditingId] = useState<string | null>(null);
  const [pendingEditedText, setPendingEditedText] = useState('');

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
    const loadAll = async () => {
      await loadBusinesses();
      const { data } = await supabase
        .from('conversations')
        .select(
          `
          *,
          ai_responses (*)
        `
        )
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (data) {
        const mapped = (data as any[]).map((conv) => ({
          conv,
          aiResponse: conv.ai_responses?.[0] ?? null,
        }));
        setPendingMessages(mapped);
      }
    };

    if (!authChecking) loadAll();
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

  const getPriorityBadge = (priority: string) => {
    const badges = {
      urgent: { bg: 'bg-red-100', text: 'text-red-800', label: '🔴 Urgente' },
      normal: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: '🟡 Normal' },
      low: { bg: 'bg-green-100', text: 'text-green-800', label: '🟢 Baja' },
    };
    const badge = badges[priority as keyof typeof badges] || badges.normal;
    return (
      <span className={`inline-block px-3 py-1 ${badge.bg} ${badge.text} text-xs rounded-full font-semibold`}>
        {badge.label}
      </span>
    );
  };

  const recargarPendientes = async () => {
    const { data } = await supabase
      .from('conversations')
      .select(
        `
        *,
        ai_responses (*)
      `
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (data) {
      const mapped = (data as any[]).map((conv) => ({
        conv,
        aiResponse: conv.ai_responses?.[0] ?? null,
      }));
      setPendingMessages(mapped);
      if (mapped.length === 0) {
        setShowPendingModal(false);
      } else if (currentPendingIndex >= mapped.length) {
        setCurrentPendingIndex(0);
      }
    }
  };

  const aprobarPendiente = async (convId: string, aiId: string | null) => {
    if (aiId) {
      await supabase
        .from('ai_responses')
        .update({ approved_at: new Date().toISOString() })
        .eq('id', aiId);
    }
    await supabase.from('conversations').update({ status: 'approved' }).eq('id', convId);
    await recargarPendientes();
    setPendingEditingId(null);
    setPendingEditedText('');
  };

  const rechazarPendiente = async (convId: string, aiId: string | null) => {
    if (aiId) {
      await supabase
        .from('ai_responses')
        .update({ rejected_at: new Date().toISOString() })
        .eq('id', aiId);
    }
    await supabase.from('conversations').update({ status: 'rejected' }).eq('id', convId);
    await recargarPendientes();
    setPendingEditingId(null);
    setPendingEditedText('');
  };

  const guardarEdicionPendiente = async (aiId: string) => {
    await supabase
      .from('ai_responses')
      .update({ edited_response: pendingEditedText })
      .eq('id', aiId);
    setPendingEditingId(null);
    setPendingEditedText('');
    await recargarPendientes();
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

        {pendingMessages.length > 0 && (
          <div className="mb-6 bg-[#0f172a] border border-[#ed8936]/60 rounded-xl p-4 text-sm flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-white">
                Tienes {pendingMessages.length} mensajes pendientes de clientes. ¿Quieres revisarlos?
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowPendingModal(true)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#ed8936] hover:bg-[#dd6b20] text-white"
            >
              Ver mensajes
            </button>
          </div>
        )}

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

      {showPendingModal && pendingMessages.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowPendingModal(false)} aria-hidden />
          <div className="relative w-full max-w-3xl max-h-[90vh] overflow-hidden bg-[#0f172a] rounded-2xl border border-white/10 shadow-2xl flex flex-col">
            <div className="flex justify-between items-center px-6 py-4 border-b border-white/10">
              <h2 className="text-lg font-bold text-white">Mensajes pendientes</h2>
              <button
                type="button"
                onClick={() => setShowPendingModal(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-colors"
                aria-label="Cerrar"
              >
                <span className="text-xl leading-none">&times;</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {pendingMessages[currentPendingIndex] && (
                <div className="bg-[#1a365d] border border-white/10 rounded-xl p-5 space-y-4">
                  {(() => {
                    const item = pendingMessages[currentPendingIndex];
                    const conv = item.conv;
                    const ai = item.aiResponse;
                    const isEditing = pendingEditingId === ai?.id;
                    const displayText = ai?.edited_response || ai?.ai_response;
                    return (
                      <>
                        <div className="flex justify-between items-start gap-3">
                          <div>
                            <h3 className="text-lg font-semibold text-white">
                              {conv.customer_name ?? 'Cliente sin nombre'}
                            </h3>
                            <p className="text-sm text-white/70">{conv.customer_contact}</p>
                            <div className="flex gap-2 mt-2 items-center">
                              <span className="inline-block px-3 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                                {conv.channel}
                              </span>
                              {getPriorityBadge(conv.priority)}
                            </div>
                          </div>
                          <span className="text-sm text-white/60">
                            {new Date(conv.created_at).toLocaleString('es-ES')}
                          </span>
                        </div>

                        <div>
                          <p className="text-sm font-semibold text-white mb-1">Mensaje del cliente</p>
                          <p className="text-sm text-[#e2e8f0] bg-[#0b1220] border border-white/10 rounded-lg p-3">
                            {conv.message}
                          </p>
                        </div>

                        {ai ? (
                          <div>
                            <p className="text-sm font-semibold text-white mb-1">
                              Respuesta sugerida por IA
                              {ai.edited_response && (
                                <span className="ml-2 text-xs text-blue-300">(editada)</span>
                              )}
                            </p>
                            {isEditing ? (
                              <div className="space-y-2">
                                <textarea
                                  className="w-full p-3 bg-[#0b1220] border border-white/20 rounded-lg text-sm text-[#e2e8f0]"
                                  rows={6}
                                  value={pendingEditedText}
                                  onChange={(e) => setPendingEditedText(e.target.value)}
                                />
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => guardarEdicionPendiente(ai.id)}
                                    className="px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg"
                                  >
                                    💾 Guardar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPendingEditingId(null);
                                      setPendingEditedText('');
                                    }}
                                    className="px-3 py-1.5 text-sm font-medium bg-gray-600 hover:bg-gray-700 text-white rounded-lg"
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-[#e2e8f0] bg-[#022c22] border border-green-500/60 rounded-lg p-3 whitespace-pre-wrap">
                                {displayText}
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-white/70">
                            Aún no se ha generado una respuesta para este mensaje.
                          </p>
                        )}

                        <div className="flex flex-wrap gap-2 pt-2">
                          {pendingMessages[currentPendingIndex].aiResponse && !pendingEditingId && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  aprobarPendiente(
                                    pendingMessages[currentPendingIndex].conv.id,
                                    pendingMessages[currentPendingIndex].aiResponse.id
                                  )
                                }
                                className="px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg"
                              >
                                ✅ Aprobar
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setPendingEditingId(
                                    pendingMessages[currentPendingIndex].aiResponse.id
                                  );
                                  setPendingEditedText(
                                    pendingMessages[currentPendingIndex].aiResponse
                                      .edited_response ||
                                      pendingMessages[currentPendingIndex].aiResponse
                                        .ai_response ||
                                      ''
                                  );
                                }}
                                className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                              >
                                ✏️ Editar
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  rechazarPendiente(
                                    pendingMessages[currentPendingIndex].conv.id,
                                    pendingMessages[currentPendingIndex].aiResponse.id
                                  )
                                }
                                className="px-3 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg"
                              >
                                ❌ Rechazar
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() =>
                  setCurrentPendingIndex((idx) => (idx > 0 ? idx - 1 : idx))
                }
                disabled={currentPendingIndex === 0}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Anterior
              </button>
              <span className="text-xs text-white/60">
                {currentPendingIndex + 1} de {pendingMessages.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  setCurrentPendingIndex((idx) =>
                    idx < pendingMessages.length - 1 ? idx + 1 : idx
                  )
                }
                disabled={currentPendingIndex >= pendingMessages.length - 1}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Siguiente →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
