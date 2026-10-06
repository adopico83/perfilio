'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Square, X } from 'lucide-react';
import { useGrabadoraAudio } from '@/hooks/use-grabadora-audio';
import {
  anadirDictado,
  detectarObraMencionada,
  type ObraDictado,
} from '@/lib/diario-dictado';

export type DatosEntradaDictada = {
  obraId: string;
  texto: string;
  fotos: string[];
};

type Props = {
  obras: ObraDictado[];
  businessId: string;
  /** Obra preseleccionada (desde una carpeta concreta o desde `?obra=`). */
  obraIdInicial?: string | null;
  /** En la demo no se suben fotos (no se escribe nada fuera del navegador). */
  demo?: boolean;
  /** Guarda la entrada. Devuelve un mensaje de error, o null si ha ido bien. */
  onGuardar: (datos: DatosEntradaDictada) => Promise<string | null>;
  onClose: () => void;
};

export default function DictarEntradaModal({
  obras,
  businessId,
  obraIdInicial = null,
  demo = false,
  onGuardar,
  onClose,
}: Props) {
  const [obraId, setObraId] = useState(obraIdInicial ?? '');
  const [texto, setTexto] = useState('');
  const [fotos, setFotos] = useState<string[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorLocal, setErrorLocal] = useState('');
  const [avisoIgnorado, setAvisoIgnorado] = useState<string | null>(null);
  const inputFotoRef = useRef<HTMLInputElement | null>(null);

  // Cada dictado nuevo se AÑADE a lo que ya hay en el cuadro de texto.
  const grabadora = useGrabadoraAudio({
    onTexto: (nuevo) => setTexto((actual) => anadirDictado(actual, nuevo)),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !guardando) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, guardando]);

  const otraObra = detectarObraMencionada(texto, obras, obraId || null);
  const mostrarAviso = otraObra && otraObra.id !== avisoIgnorado;
  const puedeGuardar = Boolean(obraId) && texto.trim().length > 0 && !guardando && !subiendo && !grabadora.grabando;
  const ocupadoMicro = grabadora.transcribiendo || guardando;

  const subirFotos = async (files: FileList | null) => {
    if (!files || files.length === 0 || demo) return;
    setSubiendo(true);
    setErrorLocal('');
    try {
      const nuevas: string[] = [];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('file', file);
        form.append('business_id', businessId);
        const res = await fetch('/api/diario/upload', { method: 'POST', body: form, credentials: 'include' });
        const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!res.ok || !json.url) {
          setErrorLocal(json.error ?? 'No se pudo subir la foto');
          break;
        }
        nuevas.push(json.url);
      }
      if (nuevas.length > 0) setFotos((prev) => [...prev, ...nuevas]);
    } catch {
      setErrorLocal('Error de conexión al subir la foto');
    } finally {
      setSubiendo(false);
      if (inputFotoRef.current) inputFotoRef.current.value = '';
    }
  };

  const guardar = async () => {
    if (!puedeGuardar) return;
    setGuardando(true);
    setErrorLocal('');
    const error = await onGuardar({ obraId, texto: texto.trim(), fotos });
    setGuardando(false);
    if (error) setErrorLocal(error);
  };

  const error = errorLocal || grabadora.error;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
      role="presentation"
      onClick={() => !guardando && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Dictar entrada del diario"
        className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-y-auto rounded-t-2xl sm:rounded-xl border border-[#A04A2F]/40 bg-[#EFEADF] p-5 text-zinc-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={guardando}
          aria-label="Cerrar"
          className="absolute right-3 top-3 rounded-lg p-2 text-zinc-600 hover:bg-[#E5DFD0]"
        >
          <X className="size-5" aria-hidden />
        </button>

        <h2 className="pr-8 text-xl font-bold">Dictar entrada</h2>

        <label className="mt-4 block text-sm font-semibold" htmlFor="dictar-obra">
          Obra <span className="text-[#A04A2F]">*</span>
        </label>
        <select
          id="dictar-obra"
          value={obraId}
          onChange={(e) => {
            setObraId(e.target.value);
            setAvisoIgnorado(null);
          }}
          className="mt-1 w-full rounded-lg border border-zinc-400/50 bg-[#E5DFD0] px-3 py-3 text-base"
        >
          <option value="">Elige la obra…</option>
          {obras.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nombre}
              {o.direccion ? ` — ${o.direccion}` : ''}
            </option>
          ))}
        </select>

        <div className="mt-5 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={grabadora.grabando ? grabadora.parar : grabadora.empezar}
            disabled={ocupadoMicro}
            aria-label={grabadora.grabando ? 'Parar grabación' : 'Empezar a dictar'}
            className={`flex size-24 items-center justify-center rounded-full text-white shadow-lg transition-colors disabled:opacity-50 touch-manipulation ${
              grabadora.grabando ? 'bg-red-600 animate-pulse' : 'bg-[#A04A2F] hover:bg-[#8a3f28]'
            }`}
          >
            {grabadora.grabando ? <Square className="size-9" aria-hidden /> : <Mic className="size-10" aria-hidden />}
          </button>
          <p className="text-sm text-zinc-700" role="status">
            {grabadora.grabando
              ? 'Grabando… pulsa para parar'
              : grabadora.transcribiendo
                ? 'Transcribiendo…'
                : 'Pulsa y cuenta qué se ha hecho hoy'}
          </p>
        </div>

        <label className="mt-4 block text-sm font-semibold" htmlFor="dictar-texto">
          Texto de la entrada <span className="text-[#A04A2F]">*</span>
        </label>
        <textarea
          id="dictar-texto"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={6}
          placeholder="Lo que dictes aparecerá aquí. Puedes corregirlo o escribir."
          className="mt-1 w-full rounded-lg border border-zinc-400/50 bg-[#E5DFD0] px-3 py-2 text-base"
        />

        {mostrarAviso && otraObra ? (
          <div role="alert" className="mt-3 rounded-lg border border-[#A04A2F]/50 bg-[#E5DFD0] p-3 text-sm">
            <p>
              Has dicho «{otraObra.nombre}», ¿la guardo en {otraObra.nombre}?
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setObraId(otraObra.id)}
                className="rounded-lg bg-[#5a7a4a] px-3 py-1.5 font-medium text-white hover:bg-[#4d6b40]"
              >
                Sí, guardar en {otraObra.nombre}
              </button>
              <button
                type="button"
                onClick={() => setAvisoIgnorado(otraObra.id)}
                className="rounded-lg bg-[#D4CCBC] px-3 py-1.5 font-medium hover:bg-[#c9c0ae]"
              >
                No, dejarla donde está
              </button>
            </div>
          </div>
        ) : null}

        {!demo ? (
          <div className="mt-4">
            <input
              ref={inputFotoRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => void subirFotos(e.target.files)}
              className="sr-only"
              id="dictar-fotos"
            />
            <label
              htmlFor="dictar-fotos"
              className="inline-flex cursor-pointer items-center rounded-lg bg-[#D4CCBC] px-3 py-2 text-sm font-medium hover:bg-[#c9c0ae]"
            >
              {subiendo ? 'Subiendo foto…' : '📷 Añadir fotos (opcional)'}
            </label>
            {fotos.length > 0 ? (
              <p className="mt-1 text-xs text-zinc-600">
                {fotos.length} {fotos.length === 1 ? 'foto añadida' : 'fotos añadidas'}
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-3 text-sm text-[#A04A2F]">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={!puedeGuardar}
            className="flex-1 rounded-lg bg-[#5a7a4a] px-4 py-3 text-base font-semibold text-white hover:bg-[#4d6b40] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={guardando}
            className="rounded-lg bg-[#E5DFD0] px-4 py-3 text-base font-medium hover:bg-[#D4CCBC]"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
