'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type TouchEvent,
} from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Loader2, Pause } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface BusinessProfile {
  id: string;
  nombre: string | null;
  sector: string | null;
}

type MessageRole = 'user' | 'assistant';

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
}

/** Texto legible para TTS a partir del markdown del agente. */
function textoPlanoParaTts(markdown: string): string {
  return markdown
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function AssistantTtsButton({
  content,
  isLoading,
  isActive,
  isPaused,
  onToggle,
}: {
  content: string;
  isLoading: boolean;
  isActive: boolean;
  isPaused: boolean;
  onToggle: () => void;
}) {
  if (!textoPlanoParaTts(content).trim()) return null;

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isLoading}
      aria-label={
        isLoading
          ? 'Generando audio…'
          : isActive && !isPaused
            ? 'Pausar lectura'
            : isActive && isPaused
              ? 'Reanudar lectura'
              : 'Escuchar respuesta en voz alta'
      }
      className="shrink-0 mt-0.5 size-8 flex items-center justify-center rounded-lg border border-[#ed8936]/80 bg-[#ed8936]/15 text-lg leading-none text-[#ed8936] hover:bg-[#ed8936]/28 transition-colors disabled:opacity-70 touch-manipulation"
    >
      {isLoading ? (
        <Loader2 className="size-4 animate-spin text-[#ed8936]" aria-hidden />
      ) : isActive && !isPaused ? (
        <Pause className="size-4 text-[#ed8936]" aria-hidden />
      ) : isActive && isPaused ? (
        <span className="text-sm text-[#ed8936]" aria-hidden>
          ▶
        </span>
      ) : (
        <span aria-hidden>🔊</span>
      )}
    </button>
  );
}

function AgentTypingIndicator() {
  return (
    <div className="flex justify-start" aria-live="polite">
      <div
        className="max-w-[90%] px-4 py-3 rounded-xl rounded-bl-md bg-[#1a365d] text-white border border-white/15"
        role="status"
      >
        <span className="sr-only">El agente está escribiendo</span>
        <div className="flex items-center gap-1.5 h-4">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="agent-typing-dot inline-block size-1.5 rounded-full bg-white shrink-0"
              style={{ animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const generateConversationId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `conv_${Date.now()}`;
};

export default function AgentSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  );

  const [selectedId, setSelectedId] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [historial, setHistorial] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [grabando, setGrabando] = useState(false);
  const [error, setError] = useState('');

  const listRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const mediaRecorderMimeTypeRef = useRef<string>('audio/webm');
  const historialInicialCargadoRef = useRef(false);
  /** Evita doble ejecución pointerdown + click; getUserMedia debe ir en el gesto directo (Safari iOS). */
  const micGestureHandledRef = useRef(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsBlobUrlRef = useRef<string | null>(null);
  const [ttsLoadingId, setTtsLoadingId] = useState<string | null>(null);
  const [ttsPlaybackMessageId, setTtsPlaybackMessageId] = useState<string | null>(null);
  const [ttsPlaybackPaused, setTtsPlaybackPaused] = useState(true);

  const revokeTtsBlob = useCallback(() => {
    if (ttsBlobUrlRef.current) {
      URL.revokeObjectURL(ttsBlobUrlRef.current);
      ttsBlobUrlRef.current = null;
    }
  }, []);

  const stopTts = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
    revokeTtsBlob();
    setTtsPlaybackMessageId(null);
    setTtsPlaybackPaused(true);
  }, [revokeTtsBlob]);

  useEffect(() => {
    return () => {
      stopTts();
    };
  }, [stopTts]);

  const toggleAssistantTts = useCallback(
    async (messageId: string, markdown: string) => {
      const plain = textoPlanoParaTts(markdown).trim();
      if (!plain) return;

      const audio = audioRef.current;
      if (ttsLoadingId === messageId) return;

      if (ttsPlaybackMessageId === messageId && audio?.src) {
        if (!audio.paused) {
          audio.pause();
          return;
        }
        await audio.play().catch(() => {});
        return;
      }

      stopTts();
      setTtsLoadingId(messageId);

      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texto: plain }),
        });
        if (!res.ok) return;

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        ttsBlobUrlRef.current = url;

        const el = audioRef.current;
        if (!el) {
          revokeTtsBlob();
          return;
        }
        el.src = url;
        await el.play().catch(() => {});
        setTtsPlaybackMessageId(messageId);
        setTtsPlaybackPaused(false);
      } catch {
        revokeTtsBlob();
      } finally {
        setTtsLoadingId(null);
      }
    },
    [ttsLoadingId, ttsPlaybackMessageId, stopTts, revokeTtsBlob]
  );

  const containerWidthClass = useMemo(() => {
    if (collapsed) return 'w-[56px] min-w-[56px]';
    return 'w-full min-w-[320px]';
  }, [collapsed]);

  useEffect(() => {
    const loadInitialData = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setCurrentUserId(user?.id ?? null);
      setCurrentUserEmail(user?.email ?? null);

      if (!user?.id) {
        setSelectedId('');
        return;
      }

      const { data, error: e } = await supabase
        .from('business_profiles')
        .select('id')
        .eq('user_id', user.id)
        .limit(1)
        .single();

      if (!e && data?.id) {
        setSelectedId(data.id);
      } else {
        setSelectedId('');
      }
    };

    void loadInitialData();
  }, [supabase]);

  useEffect(() => {
    const loadHistorialInicial = async () => {
      if (!selectedId || !currentUserId || historialInicialCargadoRef.current) return;
      historialInicialCargadoRef.current = true;

      const latestRowRes = await supabase
        .from('conversation_history')
        .select('conversation_id, business_id, user_id, created_at')
        .eq('business_id', selectedId)
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (latestRowRes.error) {
        console.log('Error cargando última conversación (conversation_history):', latestRowRes.error);
      }

      const latestConversationId =
        (latestRowRes.data?.[0] as { conversation_id?: string } | undefined)?.conversation_id ??
        null;
      const activeConversationId = latestConversationId ?? generateConversationId();
      setConversationId(activeConversationId);

      const { data: rows, error: rowsError } = await supabase
        .from('conversation_history')
        .select('role, content, business_id, user_id, conversation_id, created_at')
        .eq('business_id', selectedId)
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (rowsError) {
        console.log('Error cargando mensajes de conversation_history:', rowsError);
      }

      const mapped = ((rows ?? []) as Array<{ role: string; content: string }>)
        .reverse()
        .filter((r) => (r.role === 'user' || r.role === 'assistant') && typeof r.content === 'string')
        .map((r) => ({
          id:
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `m_${Date.now()}_${Math.random()}`,
          role: r.role as MessageRole,
          content: r.content,
        }));

      setHistorial(mapped);
    };

    void loadHistorialInicial();
  }, [selectedId, currentUserId, supabase]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [historial, loading, collapsed, mobileOpen]);

  const handleEnviarTexto = async (texto: string) => {
    const textoTrim = texto.trim();
    if (!selectedId || !textoTrim) {
      setError('Escribe un mensaje para el agente.');
      return;
    }
    setError('');
    setMensaje('');
    setHistorial((prev) => [
      ...prev,
      {
        id:
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `u_${Date.now()}`,
        role: 'user',
        content: textoTrim,
      },
    ]);
    setLoading(true);
    try {
      const { count: agendaCountAntes } = await supabase
        .from('agenda')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', selectedId);

      const res = await fetch('/api/agente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensaje: textoTrim,
          business_id: selectedId,
          historial,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Error al llamar al agente');
        return;
      }

      const { count: agendaCountDespues } = await supabase
        .from('agenda')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', selectedId);

      const antes = agendaCountAntes ?? 0;
      const despues = agendaCountDespues ?? 0;
      if (despues > antes) {
        window.dispatchEvent(new Event('agenda-actualizada'));
      }

      const respuestaTexto = data.respuesta ?? '';
      setHistorial((prev) => [
        ...prev,
        {
          id:
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `a_${Date.now()}`,
          role: 'assistant',
          content: respuestaTexto,
        },
      ]);

      const activeConversationId = conversationId || generateConversationId();
      if (!conversationId) setConversationId(activeConversationId);

      await supabase.from('conversation_history').insert([
        {
          conversation_id: activeConversationId,
          business_id: selectedId,
          user_id: currentUserId,
          sender_email: currentUserEmail,
          role: 'user',
          content: textoTrim,
        },
        {
          conversation_id: activeConversationId,
          business_id: selectedId,
          user_id: currentUserId,
          sender_email: currentUserEmail,
          role: 'assistant',
          content: respuestaTexto,
        },
      ]);
    } catch {
      setError('Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  const handleEnviar = () => {
    void handleEnviarTexto(mensaje);
  };

  const attachRecorderToStream = (stream: MediaStream) => {
    const preferredMimeTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/mp4a',
      'audio/aac',
    ];

    const chosenMimeType =
      preferredMimeTypes.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';

    mediaRecorderMimeTypeRef.current = chosenMimeType || 'audio/webm';

    const recorder = new MediaRecorder(
      stream,
      chosenMimeType ? { mimeType: chosenMimeType } : undefined
    );

    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const mimeType = mediaRecorderMimeTypeRef.current || 'audio/webm';
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
      audioChunksRef.current = [];
      setGrabando(false);
      void transcribeAndSend(audioBlob);
    };

    recorder.start();
  };

  /**
   * Sin `async/await` antes de getUserMedia: Safari iOS exige que la llamada sea en la misma
   * cadena síncrona que el gesto (puntero/teclado). El Promise se encadena con .then/.catch.
   */
  const requestMicAndStartRecording = () => {
    if (grabando || loading) return;
    if (typeof MediaRecorder === 'undefined') {
      setError('Tu navegador no soporta grabación de audio.');
      return;
    }
    if (!selectedId) {
      setError('No hay un negocio disponible para enviar el audio.');
      return;
    }

    setError('');
    audioChunksRef.current = [];

    if (!navigator.mediaDevices?.getUserMedia) {
      const msg = 'navigator.mediaDevices.getUserMedia no está disponible';
      console.error('[agent-sidebar getUserMedia]', msg);
      setError(msg);
      return;
    }

    try {
      const gumPromise = navigator.mediaDevices.getUserMedia({ audio: true });

      gumPromise
        .then((stream) => {
          try {
            mediaStreamRef.current = stream;
            setGrabando(true);
            attachRecorderToStream(stream);
          } catch (e: unknown) {
            console.error('[agent-sidebar MediaRecorder]', e);
            stream.getTracks().forEach((t) => t.stop());
            mediaStreamRef.current = null;
            mediaRecorderRef.current = null;
            setGrabando(false);
            const message =
              e instanceof Error
                ? `${e.name}: ${e.message}`
                : typeof e === 'object' && e !== null && 'message' in e
                  ? String((e as { message: unknown }).message)
                  : String(e);
            setError(message || 'Error al iniciar la grabación');
          }
        })
        .catch((err: unknown) => {
          console.error('[agent-sidebar getUserMedia]', err);
          mediaStreamRef.current = null;
          mediaRecorderRef.current = null;
          setGrabando(false);

          const name =
            err && typeof err === 'object' && 'name' in err
              ? String((err as { name: string }).name)
              : '';
          if (name === 'NotAllowedError') {
            setError('Permiso denegado - actívalo en Ajustes de Safari');
            return;
          }
          const message =
            err instanceof Error
              ? `${err.name}: ${err.message}`
              : typeof err === 'object' && err !== null && 'message' in err
                ? String((err as { message: unknown }).message)
                : String(err);
          setError(message || 'Error desconocido al solicitar el micrófono');
        });
    } catch (err: unknown) {
      console.error('[agent-sidebar getUserMedia]', err);
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
      setGrabando(false);
      const name =
        err && typeof err === 'object' && 'name' in err
          ? String((err as { name: string }).name)
          : '';
      if (name === 'NotAllowedError') {
        setError('Permiso denegado - actívalo en Ajustes de Safari');
        return;
      }
      const message =
        err instanceof Error
          ? `${err.name}: ${err.message}`
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : String(err);
      setError(message || 'Error síncrono al solicitar el micrófono');
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    try {
      if (recorder.state !== 'inactive') recorder.stop();
      else setGrabando(false);
    } finally {
      // Liberar el micro lo antes posible; el blob se obtendrá en `onstop`.
      const stream = mediaStreamRef.current;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      mediaStreamRef.current = null;
    }
  };

  const toggleRecording = () => {
    if (grabando) {
      stopRecording();
      return;
    }
    requestMicAndStartRecording();
  };

  const handleMicPointerDown = (disabled: boolean) => (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.button !== 0) return;
    micGestureHandledRef.current = true;
    toggleRecording();
  };

  const handleMicClick = (disabled: boolean) => (e: MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (micGestureHandledRef.current) {
      e.preventDefault();
      micGestureHandledRef.current = false;
      return;
    }
    toggleRecording();
  };

  const transcribeAndSend = async (audioBlob: Blob) => {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');

      const res = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? 'Error al transcribir audio');
        return;
      }

      const data = (await res.json()) as { texto?: string };
      const textoTranscrito = (data.texto ?? '').trim();
      if (!textoTranscrito) return;

      setMensaje(textoTranscrito);
      await handleEnviarTexto(textoTranscrito);
    } catch {
      setError('Error de conexión al transcribir');
    }
  };

  const nuevaConversacion = () => {
    setHistorial([]);
    setError('');
    setConversationId(generateConversationId());
  };

  /** iOS/Safari: onTouchEnd + preventDefault evita que el click sintético falle o se pierda detrás de capas. */
  const touchActivate = (fn: () => void, disabled?: boolean) => ({
    onTouchEnd: (e: TouchEvent) => {
      if (disabled) return;
      e.preventDefault();
      fn();
    },
  });

  const mostrarIndicadorEscribiendo =
    loading &&
    historial.length > 0 &&
    historial[historial.length - 1]?.role === 'user';

  const Panel = (
    <aside
      className={[
        'h-full bg-[#0f172a] text-white border-l border-[#1a365d]',
        'flex flex-col',
        'touch-manipulation',
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
              {...touchActivate(nuevaConversacion)}
              className="ml-2 px-2 py-1 text-xs font-medium rounded-md bg-white/10 hover:bg-white/15 border border-white/10 touch-manipulation"
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
          {...touchActivate(() => setCollapsed((v) => !v))}
          className="px-2 py-1 text-xs font-semibold rounded-md bg-white/5 hover:bg-white/10 border border-white/10 touch-manipulation"
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
              <>
                {historial.map((msg) =>
                  msg.role === 'user' ? (
                    <div key={msg.id} className="flex justify-end">
                      <div className="max-w-[90%] px-3 py-2 rounded-xl rounded-br-md bg-[#ed8936] text-white">
                        <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                      </div>
                    </div>
                  ) : (
                    <div key={msg.id} className="flex justify-start gap-1.5 items-start">
                      <div className="max-w-[min(90%,calc(100%-2.5rem))] px-3 py-2 rounded-xl rounded-bl-md bg-[#0f2744] text-white border border-white/10">
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
                      <AssistantTtsButton
                        content={msg.content}
                        isLoading={ttsLoadingId === msg.id}
                        isActive={ttsPlaybackMessageId === msg.id}
                        isPaused={ttsPlaybackPaused}
                        onToggle={() => void toggleAssistantTts(msg.id, msg.content)}
                      />
                    </div>
                  )
                )}
                {mostrarIndicadorEscribiendo && <AgentTypingIndicator />}
              </>
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
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleEnviar();
                }
              }}
              placeholder="Escribe tu mensaje…"
              rows={3}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:ring-2 focus:ring-[#ed8936] focus:border-[#ed8936] outline-none resize-none"
              disabled={loading}
            />
            <div className="grid grid-cols-[1fr_44px] gap-2">
              <button
                type="button"
                onClick={handleEnviar}
                {...touchActivate(handleEnviar, loading || grabando || !selectedId || !mensaje.trim())}
                disabled={loading || grabando || !selectedId || !mensaje.trim()}
                className="w-full py-2.5 bg-[#ed8936] hover:bg-[#dd6b20] text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
              >
                {loading ? 'Enviando…' : 'Enviar'}
              </button>

              <button
                type="button"
                aria-label={grabando ? 'Detener grabación' : 'Grabar audio'}
                disabled={loading || !selectedId}
                onPointerDown={handleMicPointerDown(loading || !selectedId)}
                onClick={handleMicClick(loading || !selectedId)}
                className={[
                  'h-full py-2.5 rounded-lg border transition-colors touch-manipulation',
                  grabando
                    ? 'bg-red-600 hover:bg-red-700 border-red-400/60 text-white animate-pulse shadow-[0_0_0_3px_rgba(248,113,113,0.2)]'
                    : 'bg-white/10 hover:bg-white/15 border-white/10 text-white',
                ].join(' ')}
              >
                🎤
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  );

  return (
    <>
      <audio
        ref={audioRef}
        className="hidden"
        playsInline
        onPlay={() => setTtsPlaybackPaused(false)}
        onPause={() => setTtsPlaybackPaused(true)}
        onEnded={() => {
          stopTts();
        }}
      />
      {/* Desktop */}
      <div className="hidden lg:block h-[calc(100vh-0px)]">{Panel}</div>

      {/* Mobile: botón flotante + drawer */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        {...touchActivate(() => setMobileOpen(true))}
        className="lg:hidden fixed bottom-5 right-5 z-40 px-4 py-3 rounded-full bg-[#ed8936] text-white font-semibold shadow-lg hover:bg-[#dd6b20] transition-colors touch-manipulation"
      >
        ✨ Agente
      </button>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 z-0 bg-black/70"
            onClick={() => setMobileOpen(false)}
            onTouchEnd={(e) => {
              e.preventDefault();
              setMobileOpen(false);
            }}
            aria-hidden
          />
          <div className="absolute right-0 top-0 bottom-0 z-10 w-[92vw] max-w-[420px] pointer-events-auto touch-manipulation">
            <div className="h-full">
              {/* Forzamos expandido en móvil */}
              <div
                className="h-full bg-[#0f172a] text-white border-l border-[#1a365d] flex flex-col w-full min-w-[320px]"
                onClick={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
              >
                <div className="h-14 px-3 flex items-center justify-between border-b border-white/10">
                  <span className="font-semibold">Agente IA ✨</span>
                  <button
                    type="button"
                    onClick={() => setMobileOpen(false)}
                    {...touchActivate(() => setMobileOpen(false))}
                    className="px-2 py-1 text-xs font-semibold rounded-md bg-white/5 hover:bg-white/10 border border-white/10 touch-manipulation"
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
                    <>
                      {historial.map((msg) =>
                        msg.role === 'user' ? (
                          <div key={msg.id} className="flex justify-end">
                            <div className="max-w-[90%] px-3 py-2 rounded-xl rounded-br-md bg-[#ed8936] text-white">
                              <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                            </div>
                          </div>
                        ) : (
                          <div key={msg.id} className="flex justify-start gap-1.5 items-start">
                            <div className="max-w-[min(90%,calc(100%-2.5rem))] px-3 py-2 rounded-xl rounded-bl-md bg-[#0f2744] text-white border border-white/10">
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
                            <AssistantTtsButton
                              content={msg.content}
                              isLoading={ttsLoadingId === msg.id}
                              isActive={ttsPlaybackMessageId === msg.id}
                              isPaused={ttsPlaybackPaused}
                              onToggle={() => void toggleAssistantTts(msg.id, msg.content)}
                            />
                          </div>
                        )
                      )}
                      {mostrarIndicadorEscribiendo && <AgentTypingIndicator />}
                    </>
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
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleEnviar();
                      }
                    }}
                    placeholder="Escribe tu mensaje…"
                    rows={3}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:ring-2 focus:ring-[#ed8936] focus:border-[#ed8936] outline-none resize-none"
                    disabled={loading}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={nuevaConversacion}
                      {...touchActivate(nuevaConversacion)}
                      className="py-2 bg-white/10 hover:bg-white/15 text-white font-semibold rounded-lg border border-white/10 transition-colors touch-manipulation"
                    >
                      Nuevo
                    </button>

                    <button
                      type="button"
                      aria-label={grabando ? 'Detener grabación' : 'Grabar audio'}
                      disabled={loading || !selectedId}
                      onPointerDown={handleMicPointerDown(loading || !selectedId)}
                      onClick={handleMicClick(loading || !selectedId)}
                      className={[
                        'py-2 rounded-lg border transition-colors touch-manipulation',
                        grabando
                          ? 'bg-red-600 hover:bg-red-700 border-red-400/60 text-white animate-pulse shadow-[0_0_0_3px_rgba(248,113,113,0.2)]'
                          : 'bg-white/10 hover:bg-white/15 border-white/10 text-white',
                      ].join(' ')}
                    >
                      🎤
                    </button>

                    <button
                      type="button"
                      onClick={handleEnviar}
                      {...touchActivate(handleEnviar, loading || grabando || !selectedId || !mensaje.trim())}
                      disabled={loading || grabando || !selectedId || !mensaje.trim()}
                      className="py-2 bg-[#ed8936] hover:bg-[#dd6b20] text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
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

