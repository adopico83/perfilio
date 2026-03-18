'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
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

export default function AgentSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const [selectedId, setSelectedId] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [historial, setHistorial] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const listRef = useRef<HTMLDivElement | null>(null);

  const containerWidthClass = useMemo(() => {
    if (collapsed) return 'w-[56px] min-w-[56px]';
    return 'w-full min-w-[320px]';
  }, [collapsed]);

  useEffect(() => {
    const loadDefaultBusiness = async () => {
      const { data, error: e } = await supabase
        .from('business_profiles')
        .select('id')
        .order('nombre')
        .limit(1)
        .single();

      if (!e && data?.id) {
        setSelectedId(data.id);
      }
    };

    loadDefaultBusiness();
  }, []);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [historial, loading, collapsed, mobileOpen]);

  const handleEnviar = async () => {
    if (!selectedId || !mensaje.trim()) {
      setError('Escribe un mensaje para el agente.');
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

  const Panel = (
    <aside
      className={[
        'h-full bg-[#0f172a] text-white border-l border-[#1a365d]',
        'flex flex-col',
        containerWidthClass,
      ].join(' ')}
    >
      <div className="h-14 px-3 flex items-center justify-between border-b border-white/10">
        {!collapsed ? (
          <div className="flex items-center gap-2">
            <span className="font-semibold">Agente IA ✨</span>
            <button
              type="button"
              onClick={nuevaConversacion}
              className="ml-2 px-2 py-1 text-xs font-medium rounded-md bg-white/10 hover:bg-white/15 border border-white/10"
            >
              Nuevo
            </button>
          </div>
        ) : (
          <span className="font-semibold text-[#ed8936]">✨</span>
        )}

        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="px-2 py-1 text-xs font-semibold rounded-md bg-white/5 hover:bg-white/10 border border-white/10"
          aria-label={collapsed ? 'Expandir panel' : 'Colapsar panel'}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      {!collapsed && (
        <>
          <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {historial.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                Escribe un mensaje para empezar.
              </div>
            ) : (
              historial.map((msg, i) =>
                msg.role === 'user' ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[90%] px-3 py-2 rounded-xl rounded-br-md bg-[#ed8936] text-white">
                      <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[90%] px-3 py-2 rounded-xl rounded-bl-md bg-[#0f2744] text-white border border-white/10">
                      <div className="text-sm leading-relaxed [&>*+*]:mt-2">
                        <ReactMarkdown
                          components={{
                            p: ({ children }) => <p className="text-white">{children}</p>,
                            strong: ({ children }) => (
                              <strong className="text-[#ed8936] font-bold">{children}</strong>
                            ),
                            ul: ({ children }) => (
                              <ul className="list-disc pl-6 space-y-1 text-white">{children}</ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="list-decimal pl-6 space-y-1 text-white">{children}</ol>
                            ),
                            li: ({ children }) => <li className="text-white">{children}</li>,
                            h1: ({ children }) => (
                              <h1 className="text-base font-bold text-white mt-2 mb-1">
                                {children}
                              </h1>
                            ),
                            h2: ({ children }) => (
                              <h2 className="text-sm font-bold text-white mt-2 mb-1">{children}</h2>
                            ),
                            h3: ({ children }) => (
                              <h3 className="text-sm font-bold text-white mt-1 mb-1">{children}</h3>
                            ),
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                )
              )
            )}
          </div>

          <div className="p-3 border-t border-white/10 space-y-2">
            {error && (
              <div className="rounded-lg bg-red-500/15 border border-red-400/30 text-red-200 px-3 py-2 text-xs">
                {error}
              </div>
            )}
            <textarea
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              placeholder="Escribe tu mensaje…"
              rows={3}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:ring-2 focus:ring-[#ed8936] focus:border-[#ed8936] outline-none resize-none"
              disabled={loading}
            />
            <button
              type="button"
              onClick={handleEnviar}
              disabled={loading || !selectedId || !mensaje.trim()}
              className="w-full py-2.5 bg-[#ed8936] hover:bg-[#dd6b20] text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        </>
      )}
    </aside>
  );

  return (
    <>
      {/* Desktop */}
      <div className="hidden lg:block h-[calc(100vh-0px)]">{Panel}</div>

      {/* Mobile: botón flotante + drawer */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed bottom-5 right-5 z-40 px-4 py-3 rounded-full bg-[#ed8936] text-white font-semibold shadow-lg hover:bg-[#dd6b20] transition-colors"
      >
        ✨ Agente
      </button>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 top-0 bottom-0 w-[92vw] max-w-[420px]">
            <div className="h-full">
              {/* Forzamos expandido en móvil */}
              <div className="h-full bg-[#0f172a] text-white border-l border-[#1a365d] flex flex-col w-full min-w-[320px]">
                <div className="h-14 px-3 flex items-center justify-between border-b border-white/10">
                  <span className="font-semibold">Agente IA ✨</span>
                  <button
                    type="button"
                    onClick={() => setMobileOpen(false)}
                    className="px-2 py-1 text-xs font-semibold rounded-md bg-white/5 hover:bg-white/10 border border-white/10"
                    aria-label="Cerrar panel"
                  >
                    ✕
                  </button>
                </div>

                <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-3">
                  {historial.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                      Escribe un mensaje para empezar.
                    </div>
                  ) : (
                    historial.map((msg, i) =>
                      msg.role === 'user' ? (
                        <div key={i} className="flex justify-end">
                          <div className="max-w-[90%] px-3 py-2 rounded-xl rounded-br-md bg-[#ed8936] text-white">
                            <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                          </div>
                        </div>
                      ) : (
                        <div key={i} className="flex justify-start">
                          <div className="max-w-[90%] px-3 py-2 rounded-xl rounded-bl-md bg-[#0f2744] text-white border border-white/10">
                            <div className="text-sm leading-relaxed [&>*+*]:mt-2">
                              <ReactMarkdown
                                components={{
                                  p: ({ children }) => <p className="text-white">{children}</p>,
                                  strong: ({ children }) => (
                                    <strong className="text-[#ed8936] font-bold">{children}</strong>
                                  ),
                                  ul: ({ children }) => (
                                    <ul className="list-disc pl-6 space-y-1 text-white">
                                      {children}
                                    </ul>
                                  ),
                                  ol: ({ children }) => (
                                    <ol className="list-decimal pl-6 space-y-1 text-white">
                                      {children}
                                    </ol>
                                  ),
                                  li: ({ children }) => <li className="text-white">{children}</li>,
                                }}
                              >
                                {msg.content}
                              </ReactMarkdown>
                            </div>
                          </div>
                        </div>
                      )
                    )
                  )}
                </div>

                <div className="p-3 border-t border-white/10 space-y-2">
                  {error && (
                    <div className="rounded-lg bg-red-500/15 border border-red-400/30 text-red-200 px-3 py-2 text-xs">
                      {error}
                    </div>
                  )}
                  <textarea
                    value={mensaje}
                    onChange={(e) => setMensaje(e.target.value)}
                    placeholder="Escribe tu mensaje…"
                    rows={3}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:ring-2 focus:ring-[#ed8936] focus:border-[#ed8936] outline-none resize-none"
                    disabled={loading}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={nuevaConversacion}
                      className="py-2 bg-white/10 hover:bg-white/15 text-white font-semibold rounded-lg border border-white/10 transition-colors"
                    >
                      Nuevo
                    </button>
                    <button
                      type="button"
                      onClick={handleEnviar}
                      disabled={loading || !selectedId || !mensaje.trim()}
                      className="py-2 bg-[#ed8936] hover:bg-[#dd6b20] text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? '…' : 'Enviar'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

