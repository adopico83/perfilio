'use client';

import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { useCanvas } from '@/contexts/canvas-context';

function estadoBadgeClass(estado: string | null | undefined): { label: string; className: string } {
  const s = (estado ?? 'borrador').toLowerCase();
  const estilos: Record<string, { label: string; className: string }> = {
    borrador: { label: 'Borrador', className: 'bg-gray-500/80 text-white' },
    pendiente: { label: 'Pendiente', className: 'bg-amber-400/95 text-gray-900' },
    aceptado: { label: 'Aceptado', className: 'bg-green-600/80 text-white' },
    aprobado: { label: 'Aprobado', className: 'bg-green-600/80 text-white' },
    rechazado: { label: 'Rechazado', className: 'bg-red-600/80 text-white' },
    facturado: { label: 'Facturado', className: 'bg-blue-600/80 text-white' },
    pagado: { label: 'Pagado', className: 'bg-green-800/95 text-white' },
    entregado: { label: 'Entregado', className: 'bg-green-600/80 text-white' },
    pagada: { label: 'Pagada', className: 'bg-green-600/80 text-white' },
    vencida: { label: 'Vencida', className: 'bg-red-600/80 text-white' },
  };
  const cfg = estilos[s] ?? {
    label: estado?.trim() ? estado : '—',
    className: 'bg-white/15 text-white/90',
  };
  return cfg;
}

function pickFirstStr(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (v == null || v === '') continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return undefined;
}

function fmtImporte(v: unknown): string {
  if (v == null || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return `${n.toFixed(2)} €`;
}

/** Importe para documentos: tolerante; '-' si no hay valor numérico (según especificación). */
function fmtImporteDoc(row: Record<string, unknown>): string {
  const v = row.importe_total ?? row.importe ?? row.total;
  if (v == null || v === '') return '-';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return `${n.toFixed(2)} €`;
}

function fmtFecha(v: unknown): string {
  if (v == null || v === '') return '—';
  const s = String(v);
  return s;
}

/** Nº legible: campos de negocio primero; si no hay, solo primeros 8 caracteres del id. */
function docNumeroDoc(row: Record<string, unknown>): string {
  const n = pickFirstStr(
    row.numero_presupuesto,
    row.numero_factura,
    row.numero_albaran,
    row.numero_documento,
    row.numero
  );
  if (n) return n;
  const id = row.id;
  if (id == null || !String(id).trim()) return '—';
  const s = String(id);
  return s.length > 8 ? `${s.slice(0, 8)}…` : s;
}

function clienteDoc(row: Record<string, unknown>): string {
  return pickFirstStr(row.cliente, row.nombre_cliente, row.cliente_nombre) ?? 'Sin especificar';
}

function fechaDoc(row: Record<string, unknown>): string {
  return pickFirstStr(row.fecha, row.fecha_creacion, row.created_at) ?? '-';
}

function verHref(tipo: string, row: Record<string, unknown>): string {
  const id = pickFirstStr(row.id);
  if (tipo === 'presupuestos' && id) {
    return `/presupuestos?id=${encodeURIComponent(id)}`;
  }
  if (tipo === 'facturas') {
    return id ? `/facturas?id=${encodeURIComponent(id)}` : '/facturas';
  }
  if (tipo === 'albaranes') {
    return id ? `/albaranes?id=${encodeURIComponent(id)}` : '/albaranes';
  }
  return '/dashboard';
}

function extractoDiario(texto: unknown, max = 120): string {
  if (texto == null) return '—';
  const t = String(texto).trim();
  if (!t) return '—';
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export default function CanvasModal() {
  const router = useRouter();
  const { isOpen, tipo, datos, titulo, cerrarCanvas } = useCanvas();

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="presentation"
      onClick={cerrarCanvas}
    >
      <div
        className="relative w-full max-w-4xl max-h-[80vh] flex flex-col rounded-xl border border-[#ed8936]/40 bg-[#1a365d] shadow-xl text-white overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-modal-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-white/10 shrink-0">
          <h2 id="canvas-modal-titulo" className="text-lg font-semibold text-[#ed8936] pr-8">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={cerrarCanvas}
            className="absolute top-3 right-3 p-1.5 rounded-lg text-[#ed8936] hover:bg-[#ed8936]/15 border border-[#ed8936]/50 transition-colors"
            aria-label="Cerrar panel visual"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4">
          {tipo === 'presupuestos' || tipo === 'facturas' || tipo === 'albaranes' ? (
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-white/10 bg-[#0f2744]/90 text-white/80">
                    <th className="px-3 py-2 font-medium">Nº documento</th>
                    <th className="px-3 py-2 font-medium">Cliente</th>
                    <th className="px-3 py-2 font-medium">Importe</th>
                    <th className="px-3 py-2 font-medium">Estado</th>
                    <th className="px-3 py-2 font-medium">Fecha</th>
                    <th className="px-3 py-2 font-medium text-right">Ver</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.map((raw, i) => {
                    const row = raw as Record<string, unknown>;
                    const est = pickFirstStr(row.estado) ?? '-';
                    const badge =
                      est === '-'
                        ? { label: '-', className: 'bg-white/10 text-white/60' }
                        : estadoBadgeClass(est);
                    const rowKey = pickFirstStr(row.id) ?? `row-${i}`;
                    return (
                      <tr key={rowKey} className="border-b border-white/5 hover:bg-white/5">
                        <td className="px-3 py-2 tabular-nums">{docNumeroDoc(row)}</td>
                        <td className="px-3 py-2 max-w-[10rem] truncate">{clienteDoc(row)}</td>
                        <td className="px-3 py-2 tabular-nums">{fmtImporteDoc(row)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-white/80 text-xs">{fechaDoc(row)}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              cerrarCanvas();
                              router.push(verHref(tipo, row));
                            }}
                            className="text-[#ed8936] hover:text-[#f6ad55] font-medium cursor-pointer bg-transparent border-0 p-0 text-right"
                          >
                            Ver →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {tipo === 'emails' ? (
            <ul className="space-y-2">
              {datos.map((raw, i) => {
                const row = raw as Record<string, unknown>;
                const noLeido = Boolean(
                  row.noLeido ?? row.no_leido ?? row.unread ?? row.leido === false
                );
                const remitente =
                  pickFirstStr(
                    row.remitente,
                    row.from,
                    row.remitente_email,
                    row.sender,
                    row.de
                  ) ?? '—';
                const asunto =
                  pickFirstStr(row.asunto, row.subject, row.titulo, row.title) ?? '—';
                const fecha =
                  pickFirstStr(
                    row.fechaIso,
                    row.fecha,
                    row.fecha_iso,
                    row.date,
                    row.internalDate,
                    row.fecha_recepcion
                  ) ?? '';
                return (
                  <li
                    key={i}
                    className={`rounded-lg border px-3 py-2 ${
                      noLeido
                        ? 'border-[#ed8936]/50 bg-[#ed8936]/10'
                        : 'border-white/10 bg-[#0f2744]/50'
                    }`}
                  >
                    <p className={`text-sm ${noLeido ? 'font-semibold text-white' : 'text-white/90'}`}>
                      {remitente}
                    </p>
                    <p className="text-sm text-white/80 mt-0.5">{asunto}</p>
                    {fecha ? (
                      <p className="text-xs text-[#ed8936]/90 mt-1 tabular-nums">{fecha}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {tipo === 'gastos' ? (
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-white/10 bg-[#0f2744]/90 text-white/80">
                    <th className="px-3 py-2 font-medium">Proveedor</th>
                    <th className="px-3 py-2 font-medium">Importe</th>
                    <th className="px-3 py-2 font-medium">IVA</th>
                    <th className="px-3 py-2 font-medium">Importe total</th>
                    <th className="px-3 py-2 font-medium">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.map((raw, i) => {
                    const row = raw as Record<string, unknown>;
                    const prov =
                      pickFirstStr(row.proveedor, row.nombre_proveedor, row.proveedor_nombre) ??
                      '—';
                    const imp = row.importe ?? row.base ?? row.importe_base;
                    const iva = row.iva ?? row.cuota_iva ?? row.iva_cuota;
                    const total = row.importe_total ?? row.total;
                    const f = pickFirstStr(row.fecha, row.fecha_gasto, row.created_at) ?? '-';
                    return (
                      <tr key={pickFirstStr(row.id) ?? `g-${i}`} className="border-b border-white/5 hover:bg-white/5">
                        <td className="px-3 py-2">{prov}</td>
                        <td className="px-3 py-2 tabular-nums">{fmtImporte(imp)}</td>
                        <td className="px-3 py-2 tabular-nums">{fmtImporte(iva)}</td>
                        <td className="px-3 py-2 tabular-nums">{fmtImporte(total)}</td>
                        <td className="px-3 py-2 text-xs text-white/80">{f}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {tipo === 'diario' ? (
            <ul className="space-y-3">
              {datos.map((raw, i) => {
                const row = raw as Record<string, unknown>;
                const obra =
                  pickFirstStr(
                    row.obra_nombre,
                    row.obra,
                    row.nombre_obra,
                    row.titulo_obra,
                    row.titulo
                  ) ?? '—';
                const texto = pickFirstStr(
                  row.texto,
                  row.contenido,
                  row.descripcion,
                  row.nota,
                  row.mensaje
                );
                const fechaDiario = pickFirstStr(
                  row.fecha,
                  row.fecha_hora,
                  row.created_at
                );
                return (
                  <li
                    key={pickFirstStr(row.id) ?? `d-${i}`}
                    className="rounded-lg border border-white/10 bg-[#0f2744]/60 p-3"
                  >
                    <p className="font-semibold text-[#ed8936]">{obra}</p>
                    <p className="text-xs text-white/60 tabular-nums mt-0.5">
                      {fechaDiario ?? '-'}
                    </p>
                    <p className="text-sm text-white/85 mt-2 leading-snug">
                      {extractoDiario(texto ?? '')}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {tipo === '' && (
            <p className="text-white/70 text-sm">Tipo de vista no reconocido.</p>
          )}
        </div>
      </div>
    </div>
  );
}
