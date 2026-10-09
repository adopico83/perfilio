/**
 * «Modelo» SIMULADO del clasificador de intención, SOLO para los tests sin red. Las listas de frases viven aquí (no en el
 * producto): el clasificador real es GPT-4o mini y se mide con `npm run eval:jev-real`. Los tests que necesitan otra
 * intención la fijan a mano (`intencion`).
 */
import type { EntradaIntencion, Intencion, SalidaIntencion } from '@/lib/jev/intencion';

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();

const AFIRMA = /^(?:si|sip|vale|ok|okey|dale|venga|hazlo|adelante|confirmo|confirmado|de acuerdo|perfecto|correcto|claro|por supuesto|guardalo|hecho)(?: |$)/;
const PARA = /(?:^para\b|\b(?:espera|quieto|dejalo|olvidalo|olvida|cancela|cancelalo|anula|nada nada|todavia no|mejor no|ya lo|ese ya|no hace falta|no lo)\b)/;

export function clasificadorSimulado(e: EntradaIntencion): SalidaIntencion {
  const t = norm(e.mensaje);
  const interrogacion = e.mensaje.includes('?');
  const hayPendiente = Boolean(e.resumenPendiente);
  const hayPregunta = Boolean(e.preguntaAbierta);
  const conCifras = /\d/.test(t);
  const palabras = t.split(' ').filter(Boolean).length;
  let intencion: Intencion = 'NUEVA';
  if (hayPendiente) {
    if (AFIRMA.test(t) && !conCifras) intencion = 'CONFIRMA';
    else if (/^no\b/.test(t) && !conCifras && palabras <= 6) intencion = 'CANCELA';
    else if (PARA.test(t) && !conCifras) intencion = 'CANCELA';
    else if (conCifras || /\b(?:ponla|ponlo|cambia|cambiala|cambialo|mejor|con)\b/.test(t)) intencion = 'CORRIGE';
    else intencion = 'NUEVA';
  } else if (hayPregunta) {
    if (AFIRMA.test(t) && !conCifras) intencion = 'CONFIRMA';
    else if (/^no\b/.test(t) || PARA.test(t)) intencion = 'CANCELA';
    else if (interrogacion || /^(?:que|cuanto|cuantos|como|donde|cual|dime|ensename|apunta|crea|hazme|pon)\b/.test(t)) intencion = 'NUEVA';
    else if (palabras <= 6 || (conCifras && palabras <= 16)) intencion = 'RESPUESTA';
  } else if (AFIRMA.test(t) && palabras <= 3) {
    intencion = 'CONFIRMA';
  } else if (/^(?:no|olvidalo|cancela)$/.test(t)) {
    intencion = 'CANCELA';
  }
  return { intencion, segura: true };
}
