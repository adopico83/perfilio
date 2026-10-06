'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Formatos que probamos, en orden. Safari iOS solo graba mp4/aac; Chrome y Firefox, webm. */
const preferredMimeTypes = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/mp4a',
  'audio/aac',
];

function mensajeDeError(err: unknown, porDefecto: string): string {
  const nombre =
    err && typeof err === 'object' && 'name' in err ? String((err as { name: string }).name) : '';
  if (nombre === 'NotAllowedError') return 'Permiso denegado: activa el micrófono en los ajustes del navegador.';
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return porDefecto;
}

export type GrabadoraAudio = {
  grabando: boolean;
  transcribiendo: boolean;
  error: string;
  /** Pide el micrófono y empieza a grabar. Llámala directamente desde un clic/toque. */
  empezar: () => void;
  /** Para la grabación y manda el audio a /api/transcribe. */
  parar: () => void;
  /** Última transcripción recibida (cadena vacía hasta que haya una). */
  texto: string;
};

/**
 * Graba con el micrófono y transcribe con `/api/transcribe` (Whisper).
 *
 * Copia el orden de llamadas de `agent-sidebar.tsx` a propósito: en Safari iOS `getUserMedia` solo
 * funciona si se llama en la misma cadena síncrona que el gesto del usuario, por eso `empezar` NO es
 * `async` ni hace nada antes de pedir el micro (se encadena con `.then`).
 *
 * `onTexto` se llama con cada transcripción, para que quien use el hook pueda ir añadiéndola.
 */
export function useGrabadoraAudio(opciones: { onTexto?: (texto: string) => void } = {}): GrabadoraAudio {
  const [grabando, setGrabando] = useState(false);
  const [transcribiendo, setTranscribiendo] = useState(false);
  const [error, setError] = useState('');
  const [texto, setTexto] = useState('');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef('audio/webm');
  const onTextoRef = useRef(opciones.onTexto);
  useEffect(() => {
    onTextoRef.current = opciones.onTexto;
  });

  const liberarMicro = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Si el componente se cierra mientras se graba, se apaga el micro (si no, el móvil sigue "escuchando").
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state !== 'inactive') recorder.stop();
      }
      liberarMicro();
    };
  }, [liberarMicro]);

  const transcribir = useCallback(async (audio: Blob) => {
    try {
      const form = new FormData();
      form.append('audio', audio, 'audio.webm');
      const res = await fetch('/api/transcribe', { method: 'POST', body: form });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error?.trim() || 'Error al transcribir el audio');
        return;
      }
      const data = (await res.json()) as { texto?: string };
      const limpio = (data.texto ?? '').trim();
      if (!limpio) {
        setError('No se ha entendido nada. Inténtalo de nuevo.');
        return;
      }
      setTexto(limpio);
      onTextoRef.current?.(limpio);
    } catch {
      setError('Error al transcribir el audio');
    } finally {
      setTranscribiendo(false);
    }
  }, []);

  const conectarGrabadora = useCallback(
    (stream: MediaStream) => {
      const elegido = preferredMimeTypes.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
      mimeRef.current = elegido || 'audio/webm';
      const recorder = new MediaRecorder(stream, elegido ? { mimeType: elegido } : undefined);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const audio = new Blob(chunksRef.current, { type: mimeRef.current });
        chunksRef.current = [];
        setGrabando(false);
        setTranscribiendo(true);
        void transcribir(audio);
      };
      recorder.start();
    },
    [transcribir]
  );

  const empezar = useCallback(() => {
    if (grabando || transcribiendo) return;
    if (typeof MediaRecorder === 'undefined') {
      setError('Tu navegador no soporta grabación de audio.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Este navegador no permite usar el micrófono (¿falta HTTPS?).');
      return;
    }
    setError('');
    chunksRef.current = [];

    const fallar = (err: unknown) => {
      liberarMicro();
      recorderRef.current = null;
      setGrabando(false);
      setError(mensajeDeError(err, 'No se pudo iniciar la grabación'));
    };

    try {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          try {
            streamRef.current = stream;
            setGrabando(true);
            conectarGrabadora(stream);
          } catch (e) {
            stream.getTracks().forEach((t) => t.stop());
            fallar(e);
          }
        })
        .catch(fallar);
    } catch (err) {
      fallar(err);
    }
  }, [grabando, transcribiendo, conectarGrabadora, liberarMicro]);

  const parar = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    try {
      if (recorder.state !== 'inactive') recorder.stop();
      else setGrabando(false);
    } finally {
      // Se libera el micro ya; el audio llega en `onstop`.
      liberarMicro();
    }
  }, [liberarMicro]);

  return { grabando, transcribiendo, error, empezar, parar, texto };
}
