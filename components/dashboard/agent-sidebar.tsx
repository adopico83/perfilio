'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type TouchEvent,
} from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { History, Loader2, Paperclip, Pause, Pencil, Trash2, Video, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { isDiarioPdfDownloadLink } from '@/lib/diario-pdf-link';
import { useCanvas } from '@/contexts/canvas-context';
import { useObraModal } from '@/contexts/obra-modal-context';

interface BusinessProfile {
  id: string;
  nombre: string | null;
  sector: string | null;
}

type MessageRole = 'user' | 'assistant';

type EmailPendienteEstado = 'pendiente' | 'enviado' | 'cancelado';

interface EmailPendienteEnMensaje {
  para: string;
  asunto: string;
  cuerpo: string;
  estado: EmailPendienteEstado;
}

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  /** Data URLs para mostrar mensajes de usuario con fotos adjuntas */
  imagenPreviews?: string[];
  emailPendiente?: EmailPendienteEnMensaje;
}

interface ConversationSummaryItem {
  conversation_id: string;
  titulo: string;
  created_at: string;
  total_mensajes: number;
}

function formatFechaRelativa(input: string) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return 'Fecha desconocida';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));
  if (diff <= 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  if (diff < 7) return `Hace ${diff} días`;
  return d.toLocaleDateString('es-ES', { dateStyle: 'short' });
}

/**
 * Un INSERT con varias filas puede dejar el mismo `created_at` en usuario y asistente;
 * entonces el orden en BD no es estable. Ordenamos por tiempo y, si empatan, usuario antes que asistente.
 */
function sortMensajesHistorialPorOrdenConversacion<
  T extends { role: string; created_at?: string | null },
>(rows: T[]): T[] {
  const orderRole = (r: string) =>
    r === 'user' ? 0 : r === 'assistant' ? 1 : 2;
  return [...rows].sort((a, b) => {
    const ta = new Date(a.created_at ?? 0).getTime();
    const tb = new Date(b.created_at ?? 0).getTime();
    if (ta !== tb) return ta - tb;
    return orderRole(a.role) - orderRole(b.role);
  });
}

const TZ_MADRID = 'Europe/Madrid';

/** Prefijo en conversation_history para detectar saludo automático (sin mostrarlo en UI). */
const SALUDO_AUTO_MARKER = '__SALUDO_AUTO__\n';

function formatYmdMadrid(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_MADRID,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function getHourInMadrid(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ_MADRID,
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')?.value;
  return h != null ? parseInt(h, 10) : 0;
}

/** Quitar marcador interno del saludo automático para mostrar / TTS. */
function textoAsistenteVisible(content: string): string {
  return content.startsWith(SALUDO_AUTO_MARKER) ? content.slice(SALUDO_AUTO_MARKER.length) : content;
}

/** Reduce tamaño para el body JSON (JPEG) antes de enviar al agente. */
async function comprimirImagenParaAgente(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(new Error('read'));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('img'));
    el.src = dataUrl;
  });
  const maxSide = 1600;
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (w <= 0 || h <= 0) throw new Error('dims');
  if (w > maxSide || h > maxSide) {
    if (w >= h) {
      h = Math.round((h * maxSide) / w);
      w = maxSide;
    } else {
      w = Math.round((w * maxSide) / h);
      h = maxSide;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('ctx');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.82);
}

function parseEmailPendienteApi(
  raw: unknown
): { para: string; asunto: string; cuerpo: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.para !== 'string' || typeof o.asunto !== 'string' || typeof o.cuerpo !== 'string') {
    return null;
  }
  const para = o.para.trim();
  const asunto = o.asunto.trim();
  const cuerpo = o.cuerpo.trim();
  if (!para || !asunto || !cuerpo) return null;
  return { para, asunto, cuerpo };
}

function EmailAprobacionCard({
  email,
  sending,
  onEnviar,
  onCancelar,
}: {
  email: EmailPendienteEnMensaje;
  sending: boolean;
  onEnviar: () => void;
  onCancelar: () => void;
}) {
  if (email.estado === 'enviado') {
    return (
      <p className="text-xs text-green-400 mt-1 font-medium" role="status">
        Email enviado ✓
      </p>
    );
  }
  if (email.estado === 'cancelado') {
    return (
      <p className="text-xs text-white/65 mt-1" role="status">
        Email cancelado
      </p>
    );
  }
  return (
    <div className="mt-2 w-full rounded-lg border border-[#ed8936]/40 bg-[#1a365d]/90 p-3 space-y-2 text-left">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#ed8936]/90">
        Borrador — pendiente de tu aprobación
      </p>
      <div className="space-y-1.5 text-xs">
        <div>
          <span className="text-white/50">Para: </span>
          <span className="text-white break-all">{email.para}</span>
        </div>
        <div>
          <span className="text-white/50">Asunto: </span>
          <span className="text-white font-medium">{email.asunto}</span>
        </div>
        <div>
          <p className="text-white/50 mb-0.5">Cuerpo:</p>
          <pre className="whitespace-pre-wrap break-words text-white/90 text-[11px] leading-snug bg-black/20 rounded p-2 border border-white/10 max-h-36 overflow-y-auto">
            {email.cuerpo}
          </pre>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onEnviar}
          disabled={sending}
          className="flex-1 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold disabled:opacity-50 touch-manipulation inline-flex items-center justify-center gap-1"
        >
          {sending ? (
            <>
              <Loader2 className="size-3.5 animate-spin shrink-0" aria-hidden />
              Enviando…
            </>
          ) : (
            'Enviar ✓'
          )}
        </button>
        <button
          type="button"
          onClick={onCancelar}
          disabled={sending}
          className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-50 touch-manipulation"
        >
          Cancelar ✗
        </button>
      </div>
    </div>
  );
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

const agentAssistantMarkdownComponents = {
  p: ({ children }: { children?: ReactNode }) => <p className="text-white">{children}</p>,
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="text-[#ed8936] font-bold">{children}</strong>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="list-disc pl-6 space-y-1 text-white">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="list-decimal pl-6 space-y-1 text-white">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => <li className="text-white">{children}</li>,
  h1: ({ children }: { children?: ReactNode }) => (
    <h1 className="text-base font-bold text-white mt-2 mb-1">{children}</h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className="text-sm font-bold text-white mt-2 mb-1">{children}</h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className="text-sm font-bold text-white mt-1 mb-1">{children}</h3>
  ),
  a: ({ href, children }: { href?: string; children?: ReactNode }) => {
    const url = href ?? '#';
    if (isDiarioPdfDownloadLink(url)) {
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[#ed8936] underline underline-offset-2 decoration-[#ed8936] hover:text-[#f6ad55]"
        >
          <span className="shrink-0" aria-hidden>
            📄
          </span>
          <span>{children}</span>
        </a>
      );
    }
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#ed8936] underline underline-offset-2 hover:text-[#f6ad55]"
      >
        {children}
      </a>
    );
  },
};

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

/** Mientras Whisper transcribe el audio tras soltar el micrófono (antes de que el texto aparezca en el chat). */
function AgentTranscribingIndicator() {
  return (
    <div className="flex justify-start" aria-live="polite">
      <div
        className="max-w-[90%] px-4 py-3 rounded-xl rounded-bl-md bg-[#1a365d] text-white border border-white/15 flex items-center gap-2.5"
        role="status"
      >
        <span className="sr-only">Transcribiendo audio</span>
        <Loader2 className="size-4 text-[#ed8936] animate-spin shrink-0" aria-hidden />
        <span className="text-sm text-white/95">Transcribiendo audio</span>
        <span className="inline-flex items-center gap-0.5 h-4" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="agent-typing-dot inline-block size-1.5 rounded-full bg-white/80 shrink-0"
              style={{ animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </span>
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

function ConversacionListRow({
  conv,
  isActive,
  isConfirming,
  isDeleting,
  onSelect,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  conv: ConversationSummaryItem;
  isActive: boolean;
  isConfirming: boolean;
  isDeleting: boolean;
  onSelect: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  if (isConfirming) {
    return (
      <li>
        <div className="rounded-lg border border-[#ed8936]/50 bg-[#1a365d] px-2.5 py-2 space-y-2">
          <p className="text-xs text-white/95 leading-snug">¿Eliminar esta conversación?</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onConfirmDelete}
              disabled={isDeleting}
              className="flex-1 py-1.5 rounded-md text-xs font-semibold bg-[#ed8936] hover:bg-[#dd6b20] text-white disabled:opacity-60 inline-flex items-center justify-center gap-1 touch-manipulation"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin shrink-0" aria-hidden />
                  Eliminando…
                </>
              ) : (
                'Sí'
              )}
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              disabled={isDeleting}
              className="flex-1 py-1.5 rounded-md text-xs font-medium border border-white/25 text-white hover:bg-white/10 disabled:opacity-50 touch-manipulation"
            >
              Cancelar
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="group">
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          onClick={onSelect}
          className={[
            'flex-1 min-w-0 text-left rounded-lg border px-2.5 py-2 transition-colors',
            isActive
              ? 'border-[#ed8936]/70 bg-[#ed8936]/15'
              : 'border-white/10 bg-white/5 hover:bg-white/10',
          ].join(' ')}
        >
          <p className="text-sm text-white truncate pr-1">{conv.titulo}</p>
          <p className="mt-1 text-[11px] text-white/60">
            {formatFechaRelativa(conv.created_at)} · {conv.total_mensajes} mensajes
          </p>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRequestDelete();
          }}
          className="shrink-0 self-start mt-1 p-1.5 rounded-md border border-transparent text-white/45 hover:text-red-500 hover:border-red-500/30 hover:bg-red-500/10 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-colors touch-manipulation"
          aria-label="Eliminar conversación"
          title="Eliminar conversación"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </div>
    </li>
  );
}

export default function AgentSidebar() {
  const { abrirCanvas } = useCanvas();
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
  const [conversaciones, setConversaciones] = useState<ConversationSummaryItem[]>([]);
  const [panelConversacionesAbierto, setPanelConversacionesAbierto] = useState(false);
  const [conversacionesLoading, setConversacionesLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saludoAutomaticoCargando, setSaludoAutomaticoCargando] = useState(false);
  const [grabando, setGrabando] = useState(false);
  const [transcribiendoAudio, setTranscribiendoAudio] = useState(false);
  const [error, setError] = useState('');
  const [emailSendLoadingId, setEmailSendLoadingId] = useState<string | null>(null);
  const [imagenesPendientes, setImagenesPendientes] = useState<string[]>([]);
  const [subiendoVideo, setSubiendoVideo] = useState(false);
  const [confirmDeleteConversationId, setConfirmDeleteConversationId] = useState<string | null>(
    null
  );
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null);

  const { abrirObra } = useObraModal();

  const listRef = useRef<HTMLDivElement | null>(null);
  const fileInputImagenRef = useRef<HTMLInputElement | null>(null);
  const fileInputVideoRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const mediaRecorderMimeTypeRef = useRef<string>('audio/webm');
  const saludoDiarioEnCursoRef = useRef(false);
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

  const handleEnviarEmailAprobado = useCallback(
    async (
      messageId: string,
      ep: { para: string; asunto: string; cuerpo: string }
    ) => {
      setEmailSendLoadingId(messageId);
      setError('');
      try {
        const res = await fetch('/api/gmail/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            para: ep.para,
            asunto: ep.asunto,
            cuerpo: ep.cuerpo,
          }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setError(data.error ?? 'No se pudo enviar el email');
          return;
        }
        setHistorial((prev) =>
          prev.map((m) =>
            m.id === messageId && m.emailPendiente
              ? { ...m, emailPendiente: { ...m.emailPendiente, estado: 'enviado' } }
              : m
          )
        );
      } catch {
        setError('Error de conexión al enviar el email');
      } finally {
        setEmailSendLoadingId(null);
      }
    },
    []
  );

  const handleCancelarEmailAprobacion = useCallback((messageId: string) => {
    setHistorial((prev) =>
      prev.map((m) =>
        m.id === messageId && m.emailPendiente?.estado === 'pendiente'
          ? { ...m, emailPendiente: { ...m.emailPendiente, estado: 'cancelado' } }
          : m
      )
    );
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

  const cargarMensajesDeConversacion = useCallback(
    async (targetConversationId: string) => {
      if (!selectedId || !currentUserId || !targetConversationId) return;
      const { data: rows, error: rowsError } = await supabase
        .from('conversation_history')
        .select('role, content, business_id, user_id, conversation_id, created_at')
        .eq('business_id', selectedId)
        .eq('user_id', currentUserId)
        .eq('conversation_id', targetConversationId)
        .order('created_at', { ascending: false })
        .limit(200);

      if (rowsError) {
        console.log('Error cargando mensajes de conversation_history:', rowsError);
      }

      const sorted = sortMensajesHistorialPorOrdenConversacion(
        (rows ?? []) as Array<{ role: string; content: string; created_at?: string | null }>
      );

      const mapped = sorted
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
    },
    [currentUserId, selectedId, supabase]
  );

  const cargarConversaciones = useCallback(async () => {
    if (!selectedId || !currentUserId) return;
    setConversacionesLoading(true);
    try {
      const res = await fetch(
        `/api/agente/conversaciones?business_id=${encodeURIComponent(selectedId)}&user_id=${encodeURIComponent(currentUserId)}`
      );
      const data = (await res.json()) as { conversaciones?: ConversationSummaryItem[]; error?: string };
      if (!res.ok) {
        console.log('Error cargando conversaciones:', data.error ?? 'desconocido');
        setConversaciones([]);
        return;
      }
      const list = Array.isArray(data.conversaciones) ? data.conversaciones : [];
      setConversaciones(list);

      const latestConversationId = list[0]?.conversation_id ?? '';
      const activeConversationId = latestConversationId || generateConversationId();
      setConversationId(activeConversationId);
      await cargarMensajesDeConversacion(activeConversationId);
    } catch (e) {
      console.log('Error cargando conversaciones:', e);
      setConversaciones([]);
      const fallbackConversationId = generateConversationId();
      setConversationId(fallbackConversationId);
      setHistorial([]);
    } finally {
      setConversacionesLoading(false);
    }
  }, [cargarMensajesDeConversacion, currentUserId, selectedId]);

  useEffect(() => {
    void cargarConversaciones();
  }, [cargarConversaciones]);

  const maybeEnviarSaludoNuevaConversacion = useCallback(
    async (activeConversationId: string) => {
      if (!selectedId || !currentUserId || typeof window === 'undefined') return;
      if (saludoDiarioEnCursoRef.current) return;
      saludoDiarioEnCursoRef.current = true;

      const ymdMadrid = formatYmdMadrid(new Date());
      const storageKey = `perfilio_saludo_fecha_${selectedId}`;

      try {
        const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const { data: saludosRows, error: saludosErr } = await supabase
          .from('conversation_history')
          .select('created_at, content')
          .eq('business_id', selectedId)
          .eq('user_id', currentUserId)
          .eq('role', 'assistant')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(200);

        if (saludosErr) {
          console.log('Error comprobando saludo automático:', saludosErr);
        }

        const yaHaySaludoHoy = (saludosRows ?? []).some(
          (row) =>
            typeof row.content === 'string' &&
            row.content.startsWith(SALUDO_AUTO_MARKER) &&
            formatYmdMadrid(new Date(row.created_at)) === ymdMadrid
        );

        if (yaHaySaludoHoy) {
          window.localStorage.setItem(storageKey, ymdMadrid);
          return;
        }

        if (window.localStorage.getItem(storageKey) === ymdMadrid) {
          return;
        }

        setSaludoAutomaticoCargando(true);
        setError('');

        const h = getHourInMadrid(new Date());
        const instruccionHora =
          h < 14
            ? "Debes empezar el mensaje con 'Buenos días' (hasta las 14:00, hora España, Europe/Madrid)."
            : h < 21
              ? "Debes empezar el mensaje con 'Buenas tardes' (entre las 14:00 y las 21:00, hora España, Europe/Madrid)."
              : "Debes empezar el mensaje con 'Buenas noches' (a partir de las 21:00, hora España, Europe/Madrid).";

        const promptInterno =
          'Genera un saludo automático para el usuario.\n' +
          `${instruccionHora}\n` +
          'Luego incluye un resumen breve del día:\n' +
          '- Eventos de agenda de hoy y mañana (usa la tool recordatorio_agenda)\n' +
          "- Presupuestos pendientes de respuesta (usa listar_presupuestos filtrando estado 'pendiente')\n" +
          '- Emails urgentes si los hay (usa leer_emails_recientes)\n' +
          '- Albaranes pendientes de facturar más de 7 días (usa albaranes_sin_facturar)\n' +
          '- Consulta el tiempo para hoy y mañana en la ubicación del negocio (usa consultar_tiempo, el agente conoce la ciudad). Si hay lluvia o mal tiempo que afecte a obras, avísalo claramente.\n' +
          'Sé breve y directo, estilo asistente profesional.';

        const res = await fetch('/api/agente', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mensaje: promptInterno,
            business_id: selectedId,
            historial: [],
          }),
        });

        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          setError(String(data.error ?? 'Error al generar saludo automático'));
          return;
        }

        const obraModalRaw = (data as any).obra_modal;
        if (
          obraModalRaw &&
          typeof obraModalRaw === 'object' &&
          typeof (obraModalRaw as any).obra_id === 'string'
        ) {
          const oid = String((obraModalRaw as any).obra_id).trim();
          if (oid) queueMicrotask(() => abrirObra(oid));
        }

        const respuestaTexto =
          typeof data.respuesta === 'string' ? data.respuesta.trim() : '';
        if (!respuestaTexto) return;

        const contentParaInsertar = `${SALUDO_AUTO_MARKER}${respuestaTexto}`;

        setHistorial((prev) => [
          ...prev,
          {
            id:
              typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `sa_${Date.now()}`,
            role: 'assistant',
            content: contentParaInsertar,
          },
        ]);

        await supabase.from('conversation_history').insert([
          {
            conversation_id: activeConversationId,
            business_id: selectedId,
            user_id: currentUserId,
            sender_email: currentUserEmail,
            role: 'assistant',
            content: contentParaInsertar,
            created_at: new Date().toISOString(),
          },
        ]);

        window.dispatchEvent(new CustomEvent('perfilio:refresh'));

        window.localStorage.setItem(storageKey, ymdMadrid);
      } catch {
        setError('Error de conexión al generar saludo automático');
      } finally {
        setSaludoAutomaticoCargando(false);
        saludoDiarioEnCursoRef.current = false;
      }
    },
    [abrirObra, currentUserEmail, currentUserId, selectedId, supabase]
  );

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [historial, loading, collapsed, mobileOpen, transcribiendoAudio]);

  const handleEnviarTexto = async (
    texto: string,
    opts?: { desdeTranscripcion?: boolean }
  ) => {
    const textoTrim = texto.trim();
    const imagenesEnviar = imagenesPendientes;
    if (!selectedId || (!textoTrim && imagenesEnviar.length === 0)) {
      if (opts?.desdeTranscripcion) setTranscribiendoAudio(false);
      setError('Escribe un mensaje o adjunta una imagen del ticket.');
      return;
    }
    setError('');
    setMensaje('');
    setImagenesPendientes([]);
    const esPrimerMensajeUsuarioDeConversacion = !historial.some((m) => m.role === 'user');
    const contenidoUsuario =
      textoTrim ||
      (imagenesEnviar.length > 1
        ? `📎 ${imagenesEnviar.length} imágenes adjuntas (obra / ticket)`
        : '📎 Imagen adjunta (ticket / factura)');
    setHistorial((prev) => [
      ...prev,
      {
        id:
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `u_${Date.now()}`,
        role: 'user',
        content: contenidoUsuario,
        imagenPreviews: imagenesEnviar.length > 0 ? imagenesEnviar.slice() : undefined,
      },
    ]);
    if (opts?.desdeTranscripcion) setTranscribiendoAudio(false);
    if (esPrimerMensajeUsuarioDeConversacion) {
      const titulo = (contenidoUsuario || 'Nueva conversación').slice(0, 60);
      const createdAt = new Date().toISOString();
      const activeConversationId = conversationId || generateConversationId();
      if (!conversationId) setConversationId(activeConversationId);
      setConversaciones((prev) => {
        const sinDuplicado = prev.filter((c) => c.conversation_id !== activeConversationId);
        return [
          {
            conversation_id: activeConversationId,
            titulo: titulo.length < contenidoUsuario.length ? `${titulo}…` : titulo,
            created_at: createdAt,
            total_mensajes: 0,
          },
          ...sinDuplicado,
        ].slice(0, 20);
      });
    }
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
          ...(imagenesEnviar.length > 0 ? { imagenes: imagenesEnviar } : {}),
        }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      console.log('respuesta agente:', data);
      if (!res.ok) {
        setError(String(data.error ?? 'Error al llamar al agente'));
        return;
      }

      const canvasRaw = data.canvas;
      if (canvasRaw && typeof canvasRaw === 'object' && canvasRaw !== null) {
        const c = canvasRaw as Record<string, unknown>;
        const tipoCanvas = String(c.tipo ?? '').trim();
        const tituloCanvas = String(c.titulo ?? '').trim();
        let datosCanvas: unknown[] = [];
        if (Array.isArray(c.datos)) {
          datosCanvas = c.datos;
        } else if (c.datos && typeof c.datos === 'object') {
          datosCanvas = [c.datos];
        }
        if (tipoCanvas && tituloCanvas) {
          queueMicrotask(() => {
            abrirCanvas(tipoCanvas, datosCanvas, tituloCanvas);
          });
        }
      }

      const obraModalRaw = (data as any).obra_modal;
      if (
        obraModalRaw &&
        typeof obraModalRaw === 'object' &&
        typeof (obraModalRaw as any).obra_id === 'string'
      ) {
        const oid = String((obraModalRaw as any).obra_id).trim();
        if (oid) queueMicrotask(() => abrirObra(oid));
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

      const respuestaTexto = typeof data.respuesta === 'string' ? data.respuesta : '';
      const epApi = parseEmailPendienteApi(data.email_pendiente);
      setHistorial((prev) => [
        ...prev,
        {
          id:
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `a_${Date.now()}`,
          role: 'assistant',
          content: respuestaTexto,
          emailPendiente: epApi
            ? { ...epApi, estado: 'pendiente' as const }
            : undefined,
        },
      ]);

      const activeConversationId = conversationId || generateConversationId();
      if (!conversationId) setConversationId(activeConversationId);

      const tMs = Date.now();
      const isoUsuario = new Date(tMs).toISOString();
      const isoAsistente = new Date(tMs + 1).toISOString();

      await supabase.from('conversation_history').insert([
        {
          conversation_id: activeConversationId,
          business_id: selectedId,
          user_id: currentUserId,
          sender_email: currentUserEmail,
          role: 'user',
          content:
            imagenesEnviar.length > 0
              ? `${textoTrim ? `${textoTrim}\n` : ''}[${imagenesEnviar.length} imagen${imagenesEnviar.length === 1 ? '' : 'es'} adjunta${imagenesEnviar.length === 1 ? '' : 's'}: ticket / obra]`
              : textoTrim,
          created_at: isoUsuario,
        },
        {
          conversation_id: activeConversationId,
          business_id: selectedId,
          user_id: currentUserId,
          sender_email: currentUserEmail,
          role: 'assistant',
          content: respuestaTexto,
          created_at: isoAsistente,
        },
      ]);

      window.dispatchEvent(new CustomEvent('perfilio:refresh'));
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
      setTranscribiendoAudio(true);
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
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setTranscribiendoAudio(false);
        setError(
          typeof data?.error === 'string' && data.error.trim()
            ? data.error
            : 'Error al transcribir el audio'
        );
        return;
      }

      const data = (await res.json()) as { texto?: string };
      const textoTranscrito = (data.texto ?? '').trim();
      if (!textoTranscrito) {
        setTranscribiendoAudio(false);
        setError('Error al transcribir el audio');
        return;
      }

      setMensaje(textoTranscrito);
      await handleEnviarTexto(textoTranscrito, { desdeTranscripcion: true });
    } catch {
      setTranscribiendoAudio(false);
      setError('Error al transcribir el audio');
    }
  };

  const nuevaConversacion = () => {
    setHistorial([]);
    setError('');
    setTranscribiendoAudio(false);
    setImagenesPendientes([]);
    setSubiendoVideo(false);
    setPanelConversacionesAbierto(false);
    const nextConversationId = generateConversationId();
    setConversationId(nextConversationId);
    void maybeEnviarSaludoNuevaConversacion(nextConversationId);
  };

  const MAX_IMAGENES_AGENTE_ADJUNTAS = 15;

  const handleSeleccionarImagen = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setError('');
    const nuevas: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) {
        setError('Solo se admiten archivos de imagen.');
        return;
      }
      try {
        nuevas.push(await comprimirImagenParaAgente(file));
      } catch {
        setError('No se pudo cargar una de las imágenes. Prueba con otras fotos.');
        return;
      }
    }
    let truncadas = false;
    setImagenesPendientes((prev) => {
      const merged = [...prev, ...nuevas];
      if (merged.length > MAX_IMAGENES_AGENTE_ADJUNTAS) {
        truncadas = true;
      }
      return merged.slice(0, MAX_IMAGENES_AGENTE_ADJUNTAS);
    });
    if (truncadas) {
      setError(`Máximo ${MAX_IMAGENES_AGENTE_ADJUNTAS} imágenes por mensaje.`);
    }
  };

  const handleSeleccionarVideo = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedId) return;
    const okMime =
      file.type.startsWith('video/') ||
      /^video\//i.test(file.type) ||
      /\.(mp4|mov|webm)$/i.test(file.name);
    if (!okMime) {
      setError('Selecciona un vídeo (mp4, mov, etc.).');
      return;
    }
    setError('');
    const msgId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `v_${Date.now()}`;
    setHistorial((prev) => [...prev, { id: msgId, role: 'user', content: 'Subiendo vídeo…' }]);
    setSubiendoVideo(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('business_id', selectedId);
      const res = await fetch('/api/diario/upload', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string; url?: string };
      if (!res.ok) {
        setHistorial((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? {
                  ...m,
                  content: `Error al subir el vídeo: ${data.error ?? res.statusText}`,
                }
              : m
          )
        );
        return;
      }
      const url = data.url ?? '';
      const nombre = file.name;
      setHistorial((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                content: `Vídeo listo: ${nombre}\nURL: ${url}`,
              }
            : m
        )
      );
    } catch {
      setHistorial((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, content: 'Error de conexión al subir el vídeo.' }
            : m
        )
      );
    } finally {
      setSubiendoVideo(false);
    }
  };

  /** iOS/Safari: onTouchEnd + preventDefault evita que el click sintético falle o se pierda detrás de capas. */
  const touchActivate = (fn: () => void, disabled?: boolean) => ({
    onTouchEnd: (e: TouchEvent) => {
      if (disabled) return;
      e.preventDefault();
      fn();
    },
  });

  const seleccionarConversacion = (cid: string) => {
    if (!cid || cid === conversationId) {
      setPanelConversacionesAbierto(false);
      return;
    }
    setConversationId(cid);
    setPanelConversacionesAbierto(false);
    void cargarMensajesDeConversacion(cid);
  };

  const confirmarEliminarConversacion = async (cid: string) => {
    if (!selectedId || !currentUserId || deletingConversationId) return;
    setDeletingConversationId(cid);
    setError('');
    try {
      const { error: delErr } = await supabase
        .from('conversation_history')
        .delete()
        .eq('business_id', selectedId)
        .eq('user_id', currentUserId)
        .eq('conversation_id', cid);
      if (delErr) {
        setError(delErr.message);
        setDeletingConversationId(null);
        return;
      }
      const nextList = conversaciones.filter((c) => c.conversation_id !== cid);
      setConversaciones(nextList);
      setConfirmDeleteConversationId(null);
      setDeletingConversationId(null);
      if (conversationId === cid) {
        if (nextList.length > 0) {
          const first = nextList[0];
          setConversationId(first.conversation_id);
          void cargarMensajesDeConversacion(first.conversation_id);
        } else {
          setConversationId(generateConversationId());
          setHistorial([]);
        }
      }
    } catch {
      setError('Error al eliminar la conversación.');
      setDeletingConversationId(null);
    }
  };

  const mostrarIndicadorEscribiendo =
    saludoAutomaticoCargando ||
    (loading &&
      historial.length > 0 &&
      historial[historial.length - 1]?.role === 'user');

  const puedeEnviarMensaje =
    Boolean(selectedId) &&
    (mensaje.trim().length > 0 || imagenesPendientes.length > 0);

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
            <div className="flex flex-col leading-tight">
              <span className="font-semibold">Agente IA ✨</span>
            </div>
            <button
              type="button"
              onClick={nuevaConversacion}
              {...touchActivate(nuevaConversacion)}
              className="ml-2 px-2 py-1 text-xs font-medium rounded-md bg-white/10 hover:bg-white/15 border border-white/10 touch-manipulation"
            >
              Nuevo
            </button>
            <button
              type="button"
              onClick={() => setPanelConversacionesAbierto((v) => !v)}
              className="px-2 py-1 text-xs font-medium rounded-md bg-white/10 hover:bg-white/15 border border-white/10 touch-manipulation inline-flex items-center gap-1"
              aria-label="Mostrar conversaciones anteriores"
              title="Conversaciones"
            >
              <History className="size-3.5" aria-hidden />
              Historial
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
            {panelConversacionesAbierto ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wide text-white/60">Conversaciones</p>
                  <button
                    type="button"
                    onClick={() => setPanelConversacionesAbierto(false)}
                    className="px-2 py-1 text-xs rounded-md bg-white/10 border border-white/10 hover:bg-white/15"
                  >
                    Cerrar
                  </button>
                </div>
                {conversacionesLoading ? (
                  <p className="text-xs text-white/60">Cargando conversaciones...</p>
                ) : conversaciones.length === 0 ? (
                  <p className="text-xs text-white/60">No hay conversaciones anteriores.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {conversaciones.map((conv) => (
                      <ConversacionListRow
                        key={conv.conversation_id}
                        conv={conv}
                        isActive={conv.conversation_id === conversationId}
                        isConfirming={confirmDeleteConversationId === conv.conversation_id}
                        isDeleting={deletingConversationId === conv.conversation_id}
                        onSelect={() => seleccionarConversacion(conv.conversation_id)}
                        onRequestDelete={() => setConfirmDeleteConversationId(conv.conversation_id)}
                        onCancelDelete={() => setConfirmDeleteConversationId(null)}
                        onConfirmDelete={() => void confirmarEliminarConversacion(conv.conversation_id)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            ) : historial.length === 0 && !transcribiendoAudio ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                Escribe un mensaje para empezar.
              </div>
            ) : (
              <>
                {historial.map((msg) =>
                  msg.role === 'user' ? (
                    <div key={msg.id} className="flex justify-end">
                      <div className="max-w-[90%] px-3 py-2 rounded-xl rounded-br-md bg-[#ed8936] text-white">
                        {(msg.imagenPreviews ?? []).length > 0 ? (
                          <div className="mb-2 flex flex-wrap gap-1.5 justify-end">
                            {(msg.imagenPreviews ?? []).map((src, idx) => (
                              <img
                                key={`${msg.id}-img-${idx}`}
                                src={src}
                                alt=""
                                className="max-h-28 w-auto max-w-[45%] sm:max-w-[32%] rounded-md border border-white/25 object-cover"
                              />
                            ))}
                          </div>
                        ) : null}
                        <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                      </div>
                    </div>
                  ) : (
                    <div key={msg.id} className="flex justify-start w-full">
                      <div className="max-w-[min(90%,100%)] flex flex-col gap-0">
                        <div className="flex gap-1.5 items-start">
                          <div className="min-w-0 max-w-[min(90%,calc(100%-2.5rem))] px-3 py-2 rounded-xl rounded-bl-md bg-[#0f2744] text-white border border-white/10">
                            <div className="text-sm leading-relaxed [&>*+*]:mt-2">
                              <ReactMarkdown components={agentAssistantMarkdownComponents}>
                                {textoAsistenteVisible(msg.content)}
                              </ReactMarkdown>
                            </div>
                          </div>
                          <AssistantTtsButton
                            content={textoAsistenteVisible(msg.content)}
                            isLoading={ttsLoadingId === msg.id}
                            isActive={ttsPlaybackMessageId === msg.id}
                            isPaused={ttsPlaybackPaused}
                            onToggle={() =>
                              void toggleAssistantTts(msg.id, textoAsistenteVisible(msg.content))
                            }
                          />
                        </div>
                        {msg.emailPendiente && (
                          <EmailAprobacionCard
                            email={msg.emailPendiente}
                            sending={emailSendLoadingId === msg.id}
                            onEnviar={() =>
                              void handleEnviarEmailAprobado(msg.id, {
                                para: msg.emailPendiente!.para,
                                asunto: msg.emailPendiente!.asunto,
                                cuerpo: msg.emailPendiente!.cuerpo,
                              })
                            }
                            onCancelar={() => handleCancelarEmailAprobacion(msg.id)}
                          />
                        )}
                      </div>
                    </div>
                  )
                )}
                {transcribiendoAudio && <AgentTranscribingIndicator />}
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
            {imagenesPendientes.length > 0 ? (
              <div className="rounded-lg border border-white/10 bg-white/5 p-2 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {imagenesPendientes.map((src, idx) => (
                    <div
                      key={`pend-${idx}-${src.slice(0, 24)}`}
                      className="relative shrink-0"
                    >
                      <img
                        src={src}
                        alt=""
                        className="h-16 w-16 rounded-md border border-white/10 object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setImagenesPendientes((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="absolute -top-1 -right-1 p-1 rounded-full bg-black/70 border border-white/20 text-white hover:bg-red-600/90 touch-manipulation"
                        aria-label={`Quitar imagen ${idx + 1}`}
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-white/70">
                  {imagenesPendientes.length === 1
                    ? 'Vista previa — se enviará con el próximo mensaje'
                    : `${imagenesPendientes.length} fotos — se enviarán juntas en el próximo mensaje`}
                </p>
              </div>
            ) : null}
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
            <div className="flex gap-2 items-stretch min-h-[44px]">
              <button
                type="button"
                aria-label="Adjuntar imagen de ticket o factura"
                disabled={loading || grabando || !selectedId || subiendoVideo}
                onClick={() => fileInputImagenRef.current?.click()}
                className="w-11 shrink-0 flex items-center justify-center rounded-lg border border-white/10 bg-white/10 hover:bg-white/15 text-white transition-colors disabled:opacity-50 touch-manipulation"
              >
                <Paperclip className="size-5" aria-hidden />
              </button>
              <button
                type="button"
                aria-label="Adjuntar vídeo para el diario de obra"
                disabled={loading || grabando || !selectedId || subiendoVideo}
                onClick={() => fileInputVideoRef.current?.click()}
                className="w-11 shrink-0 flex items-center justify-center rounded-lg border border-white/10 bg-white/10 hover:bg-white/15 text-white transition-colors disabled:opacity-50 touch-manipulation"
              >
                <Video className="size-5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={handleEnviar}
                {...touchActivate(handleEnviar, loading || grabando || !puedeEnviarMensaje)}
                disabled={loading || grabando || !puedeEnviarMensaje}
                className="flex-1 min-w-0 py-2.5 bg-[#ed8936] hover:bg-[#dd6b20] text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
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
                  'w-11 shrink-0 py-2.5 rounded-lg border transition-colors touch-manipulation flex items-center justify-center',
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
      <input
        ref={fileInputImagenRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        aria-hidden
        onChange={(e) => void handleSeleccionarImagen(e)}
      />
      <input
        ref={fileInputVideoRef}
        type="file"
        accept="video/mp4,video/quicktime,video/mov,video/*"
        className="hidden"
        aria-hidden
        onChange={(e) => void handleSeleccionarVideo(e)}
      />
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
                  <div className="flex flex-col leading-tight">
                    <span className="font-semibold">Agente IA ✨</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={nuevaConversacion}
                      {...touchActivate(nuevaConversacion)}
                      className="inline-flex items-center justify-center gap-1 min-h-9 px-2 shrink-0 rounded-md bg-white/10 border border-white/10 hover:bg-white/15 touch-manipulation text-xs font-medium"
                      aria-label="Nueva conversación"
                      title="Nueva conversación"
                    >
                      <Pencil className="size-5 shrink-0" aria-hidden />
                      Nuevo
                    </button>
                    <button
                      type="button"
                      onClick={() => setPanelConversacionesAbierto((v) => !v)}
                      {...touchActivate(() => setPanelConversacionesAbierto((v) => !v))}
                      className="flex items-center justify-center w-9 h-9 shrink-0 rounded-md bg-white/10 border border-white/10 hover:bg-white/15 touch-manipulation"
                      aria-label="Mostrar conversaciones"
                      title="Conversaciones"
                    >
                      <History className="size-5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => setMobileOpen(false)}
                      {...touchActivate(() => setMobileOpen(false))}
                      className="flex items-center justify-center w-9 h-9 shrink-0 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 touch-manipulation"
                      aria-label="Cerrar panel"
                      title="Cerrar"
                    >
                      <X className="size-5" aria-hidden />
                    </button>
                  </div>
                </div>

                <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-3">
                  {panelConversacionesAbierto ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs uppercase tracking-wide text-white/60">Conversaciones</p>
                        <button
                          type="button"
                          onClick={() => setPanelConversacionesAbierto(false)}
                          className="px-2 py-1 text-xs rounded-md bg-white/10 border border-white/10 hover:bg-white/15"
                        >
                          Cerrar
                        </button>
                      </div>
                      {conversacionesLoading ? (
                        <p className="text-xs text-white/60">Cargando conversaciones...</p>
                      ) : conversaciones.length === 0 ? (
                        <p className="text-xs text-white/60">No hay conversaciones anteriores.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {conversaciones.map((conv) => (
                            <ConversacionListRow
                              key={conv.conversation_id}
                              conv={conv}
                              isActive={conv.conversation_id === conversationId}
                              isConfirming={confirmDeleteConversationId === conv.conversation_id}
                              isDeleting={deletingConversationId === conv.conversation_id}
                              onSelect={() => seleccionarConversacion(conv.conversation_id)}
                              onRequestDelete={() =>
                                setConfirmDeleteConversationId(conv.conversation_id)
                              }
                              onCancelDelete={() => setConfirmDeleteConversationId(null)}
                              onConfirmDelete={() =>
                                void confirmarEliminarConversacion(conv.conversation_id)
                              }
                            />
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : historial.length === 0 && !transcribiendoAudio ? (
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                      Escribe un mensaje para empezar.
                    </div>
                  ) : (
                    <>
                      {historial.map((msg) =>
                        msg.role === 'user' ? (
                          <div key={msg.id} className="flex justify-end">
                            <div className="max-w-[90%] px-3 py-2 rounded-xl rounded-br-md bg-[#ed8936] text-white">
                              {(msg.imagenPreviews ?? []).length > 0 ? (
                                <div className="mb-2 flex flex-wrap gap-1.5 justify-end">
                                  {(msg.imagenPreviews ?? []).map((src, idx) => (
                                    <img
                                      key={`${msg.id}-img-${idx}`}
                                      src={src}
                                      alt=""
                                      className="max-h-28 w-auto max-w-[45%] sm:max-w-[32%] rounded-md border border-white/25 object-cover"
                                    />
                                  ))}
                                </div>
                              ) : null}
                              <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                            </div>
                          </div>
                        ) : (
                          <div key={msg.id} className="flex justify-start w-full">
                            <div className="max-w-[min(90%,100%)] flex flex-col gap-0">
                              <div className="flex gap-1.5 items-start">
                                <div className="min-w-0 max-w-[min(90%,calc(100%-2.5rem))] px-3 py-2 rounded-xl rounded-bl-md bg-[#0f2744] text-white border border-white/10">
                                  <div className="text-sm leading-relaxed [&>*+*]:mt-2">
                                    <ReactMarkdown components={agentAssistantMarkdownComponents}>
                                      {textoAsistenteVisible(msg.content)}
                                    </ReactMarkdown>
                                  </div>
                                </div>
                                <AssistantTtsButton
                                  content={textoAsistenteVisible(msg.content)}
                                  isLoading={ttsLoadingId === msg.id}
                                  isActive={ttsPlaybackMessageId === msg.id}
                                  isPaused={ttsPlaybackPaused}
                                  onToggle={() =>
                                    void toggleAssistantTts(msg.id, textoAsistenteVisible(msg.content))
                                  }
                                />
                              </div>
                              {msg.emailPendiente && (
                                <EmailAprobacionCard
                                  email={msg.emailPendiente}
                                  sending={emailSendLoadingId === msg.id}
                                  onEnviar={() =>
                                    void handleEnviarEmailAprobado(msg.id, {
                                      para: msg.emailPendiente!.para,
                                      asunto: msg.emailPendiente!.asunto,
                                      cuerpo: msg.emailPendiente!.cuerpo,
                                    })
                                  }
                                  onCancelar={() => handleCancelarEmailAprobacion(msg.id)}
                                />
                              )}
                            </div>
                          </div>
                        )
                      )}
                      {transcribiendoAudio && <AgentTranscribingIndicator />}
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
                  {imagenesPendientes.length > 0 ? (
                    <div className="rounded-lg border border-white/10 bg-white/5 p-2 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {imagenesPendientes.map((src, idx) => (
                          <div
                            key={`pend-m-${idx}-${src.slice(0, 24)}`}
                            className="relative shrink-0"
                          >
                            <img
                              src={src}
                              alt=""
                              className="h-16 w-16 rounded-md border border-white/10 object-cover"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setImagenesPendientes((prev) => prev.filter((_, i) => i !== idx))
                              }
                              className="absolute -top-1 -right-1 p-1 rounded-full bg-black/70 border border-white/20 text-white hover:bg-red-600/90 touch-manipulation"
                              aria-label={`Quitar imagen ${idx + 1}`}
                            >
                              <X className="size-3" aria-hidden />
                            </button>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-white/70">
                        {imagenesPendientes.length === 1
                          ? 'Vista previa — se enviará con el próximo mensaje'
                          : `${imagenesPendientes.length} fotos — se enviarán juntas en el próximo mensaje`}
                      </p>
                    </div>
                  ) : null}
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
                  <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
                    <button
                      type="button"
                      aria-label="Adjuntar imagen"
                      disabled={loading || grabando || !selectedId || subiendoVideo}
                      onClick={() => fileInputImagenRef.current?.click()}
                      className="py-2 rounded-lg border border-white/10 bg-white/10 hover:bg-white/15 text-white transition-colors disabled:opacity-50 touch-manipulation flex items-center justify-center"
                    >
                      <Paperclip className="size-5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label="Adjuntar vídeo para el diario de obra"
                      disabled={loading || grabando || !selectedId || subiendoVideo}
                      onClick={() => fileInputVideoRef.current?.click()}
                      className="py-2 rounded-lg border border-white/10 bg-white/10 hover:bg-white/15 text-white transition-colors disabled:opacity-50 touch-manipulation flex items-center justify-center"
                    >
                      <Video className="size-5" aria-hidden />
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
                      {...touchActivate(handleEnviar, loading || grabando || !puedeEnviarMensaje)}
                      disabled={loading || grabando || !puedeEnviarMensaje}
                      className="py-2 bg-[#ed8936] hover:bg-[#dd6b20] text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation text-sm"
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

