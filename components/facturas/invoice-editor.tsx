'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';

/** Emisor Pino (alineado con `lib/pdf/factura.tsx` — TicketBAI). */
const PINO_EMISOR = {
  nif: 'B-75207308',
  nombre: 'AL&CA Pino Gutiérrez Albañilería en General S.L.',
  direccion: 'C/ Bartolomé de Urdinso Nº 15 Local 1 Bis',
  cpCiudad: '20301 Irún (Guipúzcoa)',
  telefono: '943 57 49 19',
  email: 'info@pinoalbanileria.com',
} as const;

const NAVY = '#1a365d';
const PERFILIO_LINEAS_MARKER = '__PERFILIO_LINEAS_JSON__\n';

export type FacturaEditorSource = {
  id: string;
  business_id: string;
  numero_factura: string | null;
  cliente_nombre: string | null;
  cliente_direccion: string | null;
  cliente_nif: string | null;
  descripcion_trabajos: string | null;
  lineas: unknown;
  total: number | string | null;
  fecha: string | null;
  created_at: string;
};

export type InvoiceEditLine = {
  id: string;
  descripcion: string;
  cantidad: string;
  precio_unitario: string;
};

function newLineId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `ln-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseNumInput(s: string): number {
  const n = parseFloat(String(s ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function lineImporte(cantidad: string, precioUnitario: string): number {
  const c = parseNumInput(cantidad);
  const p = parseNumInput(precioUnitario);
  return parseFloat((c * p).toFixed(2));
}

function splitDirCiudad(full: string | null | undefined): { dir: string; ciudad: string } {
  const s = (full ?? '').trim();
  if (!s) return { dir: '—', ciudad: '—' };
  const lastComma = s.lastIndexOf(',');
  if (lastComma <= 0) return { dir: s, ciudad: '—' };
  return { dir: s.slice(0, lastComma).trim(), ciudad: s.slice(lastComma + 1).trim() };
}

function mapRawLineToEditLine(row: unknown, index: number): InvoiceEditLine {
  const r = row as Record<string, unknown>;
  const desc = String(r.descripcion ?? r.concepto ?? r.texto ?? '').trim();
  const cant = parseNumInput(String(r.cantidad ?? 1));
  const pu = parseNumInput(String(r.precio_unitario ?? r.precio ?? 0));
  const importeRaw = r.importe;
  let precio = pu;
  if (!precio && importeRaw != null && cant > 0) {
    precio = parseFloat((parseNumInput(String(importeRaw)) / cant).toFixed(2));
  }
  return {
    id: newLineId(),
    descripcion: desc || `Concepto ${index + 1}`,
    cantidad: String(cant || 1),
    precio_unitario: String(precio),
  };
}

/** Igual que el PDF: partidas desde `lineas` (JSON/array) o bloque embebido / texto en `descripcion_trabajos`. */
export function parseFacturaItemsForEditor(f: FacturaEditorSource): InvoiceEditLine[] {
  let raw: unknown = f.lineas;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('[') || t.startsWith('{')) {
      try {
        raw = JSON.parse(t) as unknown;
      } catch {
        raw = null;
      }
    } else {
      raw = null;
    }
  }

  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((row, i) => mapRawLineToEditLine(row, i));
  }

  const desc = f.descripcion_trabajos ?? '';
  const markerIdx = desc.indexOf(PERFILIO_LINEAS_MARKER);
  if (markerIdx !== -1) {
    try {
      const jsonPart = desc.slice(markerIdx + PERFILIO_LINEAS_MARKER.length).trim();
      const parsed = JSON.parse(jsonPart) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((row, i) => mapRawLineToEditLine(row, i));
      }
    } catch {
      /* ignore */
    }
  }

  const lines = desc
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('__PERFILIO_'));
  if (lines.length > 1) {
    return lines.map((l) => ({
      id: newLineId(),
      descripcion: l,
      cantidad: '1',
      precio_unitario: '0',
    }));
  }
  if (lines.length === 1) {
    return [
      {
        id: newLineId(),
        descripcion: lines[0]!,
        cantidad: '1',
        precio_unitario: '0',
      },
    ];
  }

  return [
    {
      id: newLineId(),
      descripcion: 'Concepto',
      cantidad: '1',
      precio_unitario: '0',
    },
  ];
}

export function buildDescripcionTrabajosFromItems(items: InvoiceEditLine[]): string {
  const payload = items.map((it) => {
    const cantidad = parseNumInput(it.cantidad);
    const precio_unitario = parseNumInput(it.precio_unitario);
    const importe = lineImporte(it.cantidad, it.precio_unitario);
    return {
      descripcion: it.descripcion.trim(),
      cantidad,
      precio_unitario,
      importe,
    };
  });
  const human = items
    .map((it) => {
      const imp = lineImporte(it.cantidad, it.precio_unitario);
      const d = it.descripcion.trim();
      return `${d} — ${parseNumInput(it.cantidad)} ud × ${parseNumInput(it.precio_unitario)} € = ${imp.toFixed(2)} €`;
    })
    .join('\n');
  return human.trim()
    ? `${human.trim()}\n\n${PERFILIO_LINEAS_MARKER}${JSON.stringify(payload)}`
    : `${PERFILIO_LINEAS_MARKER}${JSON.stringify(payload)}`;
}

function fmtEuroEs(n: number): string {
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export type InvoiceEditorSavePayload = {
  cliente_nombre: string;
  importe_total: number;
  descripcion_trabajos: string;
};

export type InvoiceEditorProps = {
  factura: FacturaEditorSource;
  onClose: () => void;
  onSave: (payload: InvoiceEditorSavePayload) => Promise<void>;
  saving?: boolean;
  error?: string;
  saved?: boolean;
};

export function InvoiceEditor({
  factura,
  onClose,
  onSave,
  saving = false,
  error = '',
  saved = false,
}: InvoiceEditorProps) {
  const [clienteNombre, setClienteNombre] = useState(factura.cliente_nombre ?? '');
  const [items, setItems] = useState<InvoiceEditLine[]>(() => parseFacturaItemsForEditor(factura));
  const [logoFailed, setLogoFailed] = useState(false);
  const [totalsFlash, setTotalsFlash] = useState(false);
  const [localError, setLocalError] = useState('');
  const prevTotalsKey = useRef<string | null>(null);
  const skipFirstTotalsEffect = useRef(true);

  const subtotal = useMemo(() => {
    const sum = items.reduce((s, it) => s + lineImporte(it.cantidad, it.precio_unitario), 0);
    return parseFloat(sum.toFixed(2));
  }, [items]);
  const iva = useMemo(() => parseFloat((subtotal * 0.21).toFixed(2)), [subtotal]);
  const total = useMemo(() => parseFloat((subtotal + iva).toFixed(2)), [subtotal, iva]);

  const totalsKey = `${subtotal.toFixed(2)}|${iva.toFixed(2)}|${total.toFixed(2)}`;

  useEffect(() => {
    if (skipFirstTotalsEffect.current) {
      skipFirstTotalsEffect.current = false;
      prevTotalsKey.current = totalsKey;
      return;
    }
    if (prevTotalsKey.current === totalsKey) return;
    prevTotalsKey.current = totalsKey;
    let cancelled = false;
    let innerId: number | undefined;
    const t0 = window.setTimeout(() => {
      if (cancelled) return;
      setTotalsFlash(true);
      innerId = window.setTimeout(() => {
        if (!cancelled) setTotalsFlash(false);
      }, 500);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t0);
      if (innerId) clearTimeout(innerId);
    };
  }, [totalsKey]);

  const fechaEmision =
    factura.fecha ?? new Date(factura.created_at).toISOString().split('T')[0] ?? '—';
  const { dir: clienteDir, ciudad: clienteCiudad } = splitDirCiudad(factura.cliente_direccion);

  const updateLine = useCallback((id: string, patch: Partial<Pick<InvoiceEditLine, 'descripcion' | 'cantidad' | 'precio_unitario'>>) => {
    setLocalError('');
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const addLine = useCallback(() => {
    setLocalError('');
    setItems((prev) => [
      ...prev,
      { id: newLineId(), descripcion: '', cantidad: '1', precio_unitario: '0' },
    ]);
  }, []);

  const removeLine = useCallback((id: string) => {
    setLocalError('');
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((it) => it.id !== id)));
  }, []);

  const handleSave = async () => {
    setLocalError('');
    const cn = clienteNombre.trim();
    if (!cn) {
      setLocalError('El cliente no puede estar vacío.');
      return;
    }
    const hasContent = items.some((it) => it.descripcion.trim().length > 0);
    if (!hasContent) {
      setLocalError('Añade al menos una línea con descripción.');
      return;
    }
    const desc = buildDescripcionTrabajosFromItems(items);
    if (!desc.trim()) {
      setLocalError('No se pudo generar la descripción de trabajos.');
      return;
    }
    await onSave({
      cliente_nombre: cn,
      importe_total: total,
      descripcion_trabajos: desc,
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#0b1220]/95">
      <div className="flex shrink-0 justify-end p-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/90 hover:bg-white/10"
          aria-label="Cerrar"
        >
          <X className="size-4" />
          Cerrar
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-2">
        <div className="mx-auto w-full max-w-[210mm] shadow-lg">
          <div className="rounded-sm bg-white px-5 pb-8 pt-6 text-[11px] leading-snug text-neutral-900 shadow-lg">
            {/* Cabecera tipo PDF */}
            <div className="mb-4 flex flex-row items-start gap-2">
              <div className="w-[22%] shrink-0">
                <div className="relative flex h-16 w-[120px] items-center justify-center">
                  {!logoFailed ? (
                    <img
                      src="/logo-pino.png"
                      alt="Logo"
                      width={120}
                      height={64}
                      className="max-h-16 w-[120px] object-contain"
                      onError={() => setLogoFailed(true)}
                    />
                  ) : (
                    <span className="text-[9px] font-bold" style={{ color: NAVY }}>
                      PINO
                    </span>
                  )}
                </div>
              </div>
              <div className="flex w-[36%] flex-col items-center justify-center pt-1 text-center">
                <h1 className="text-[14px] font-bold" style={{ color: NAVY }}>
                  FAKTURA / FACTURA
                </h1>
              </div>
              <div className="w-[42%] shrink-0 pl-1.5 text-[8.5px] leading-[1.35]">
                <p>
                  <span className="font-bold">Zenbakia / Número : </span>
                  {factura.numero_factura ?? '—'}
                </p>
                <p>
                  <span className="font-bold">Jaulkipena / Emisión : </span>
                  {fechaEmision}
                </p>
                <p>
                  <span className="font-bold">Mota / Tipo : </span>
                  Osoa / Completa
                </p>
                <p>
                  <span className="font-bold">Deskribapena / Descripción : </span>
                  Factura por trabajos realizados
                </p>
              </div>
            </div>

            {/* Emisor + cliente */}
            <div className="mb-3 flex flex-row gap-2.5">
              <div
                className="min-w-0 flex-1 border border-neutral-300 bg-[#f5f5f5] p-2 text-[9px] leading-[1.35]"
              >
                <p className="mb-1">
                  <span className="font-bold">{PINO_EMISOR.nif}</span>
                  <span className="mx-2 font-bold">{PINO_EMISOR.nombre}</span>
                </p>
                <p>{PINO_EMISOR.direccion}</p>
                <p>{PINO_EMISOR.cpCiudad}</p>
                <p className="mt-1">
                  <span className="font-bold">Tel.: </span>
                  {PINO_EMISOR.telefono}
                  <span className="ml-3 font-bold">Email: </span>
                  {PINO_EMISOR.email}
                </p>
              </div>
              <div
                className="min-w-0 flex-1 border border-neutral-300 bg-[#f5f5f5] p-2 text-[9px] leading-[1.35]"
              >
                <p className="mb-1.5 text-[9px] font-bold" style={{ color: NAVY }}>
                  BEZEROA / CLIENTE
                </p>
                <label className="block">
                  <span className="font-bold">Nombre: </span>
                  <input
                    type="text"
                    value={clienteNombre}
                    onChange={(e) => {
                      setLocalError('');
                      setClienteNombre(e.target.value);
                    }}
                    className="mt-0.5 w-full cursor-text border border-neutral-200 bg-white px-1.5 py-1 text-[9px] outline-none focus:ring-1 focus:ring-[#ed8936]"
                  />
                </label>
                <p className="mt-1">
                  <span className="font-bold">NIF: </span>
                  {factura.cliente_nif?.trim() || '—'}
                </p>
                <p>
                  <span className="font-bold">Dirección: </span>
                  {clienteDir}
                </p>
                <p>
                  <span className="font-bold">Ciudad: </span>
                  {clienteCiudad}
                </p>
              </div>
            </div>

            {/* Tabla líneas */}
            <div
              className="flex flex-row bg-[#1a365d] px-1 py-1 text-[7.5px] font-bold text-white"
              style={{ color: '#fff' }}
            >
              <div className="w-[26%] text-left">Deskribapena / Concepto</div>
              <div className="w-[8%] text-center">Kopurua / Cant.</div>
              <div className="w-[10%] text-right">Prezio / Precio</div>
              <div className="w-[8%] text-center">Dto %</div>
              <div className="w-[14%] text-right">Oinarria / Base</div>
              <div className="w-[10%] text-center">BEZ %</div>
              <div className="w-[6%] text-center">RE %</div>
              <div className="w-[18%] text-right">Guztira / Total línea</div>
            </div>

            {items.map((it, idx) => {
              const baseLinea = lineImporte(it.cantidad, it.precio_unitario);
              const totalLinea = parseFloat((baseLinea * 1.21).toFixed(2));
              const alt = idx % 2 === 1 ? 'bg-[#fafafa]' : 'bg-white';
              return (
                <div
                  key={it.id}
                  className={`flex flex-row border-b border-neutral-200 px-1 py-1.5 text-[8.5px] ${alt}`}
                >
                  <div className="group w-[26%] min-w-0 px-0.5 hover:bg-amber-50/40">
                    <input
                      type="text"
                      value={it.descripcion}
                      onChange={(e) => updateLine(it.id, { descripcion: e.target.value })}
                      className="w-full cursor-text border-0 bg-transparent px-0.5 py-0.5 text-left outline-none focus:ring-1 focus:ring-[#ed8936]/60"
                    />
                  </div>
                  <div className="group w-[8%] px-0.5 text-center hover:bg-amber-50/40">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={it.cantidad}
                      onChange={(e) => updateLine(it.id, { cantidad: e.target.value })}
                      className="w-full cursor-text border-0 bg-transparent px-0.5 py-0.5 text-center outline-none focus:ring-1 focus:ring-[#ed8936]/60"
                    />
                  </div>
                  <div className="group w-[10%] px-0.5 text-right hover:bg-amber-50/40">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={it.precio_unitario}
                      onChange={(e) => updateLine(it.id, { precio_unitario: e.target.value })}
                      className="w-full cursor-text border-0 bg-transparent px-0.5 py-0.5 text-right outline-none focus:ring-1 focus:ring-[#ed8936]/60"
                    />
                  </div>
                  <div className="flex w-[8%] items-center justify-center text-neutral-500">—</div>
                  <div className="w-[14%] text-right tabular-nums">{fmtEuroEs(baseLinea)}</div>
                  <div className="flex w-[10%] items-center justify-center">21%</div>
                  <div className="flex w-[6%] items-center justify-center text-neutral-500">—</div>
                  <div className="flex w-[18%] items-center justify-end gap-1">
                    <span className="tabular-nums">{fmtEuroEs(totalLinea)}</span>
                    {items.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeLine(it.id)}
                        className="shrink-0 text-[9px] text-red-600 underline opacity-70 hover:opacity-100"
                      >
                        Quitar
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}

            <button
              type="button"
              onClick={addLine}
              className="mt-2 text-[10px] font-semibold text-[#1a365d] underline hover:text-[#ed8936]"
            >
              + Añadir línea
            </button>

            {/* Totales (recalculados al vuelo) */}
            <div
              className={`mt-4 border border-neutral-400 transition-colors duration-300 ${
                totalsFlash ? 'bg-amber-100/90 ring-2 ring-amber-300' : ''
              }`}
            >
              <div className="flex flex-row bg-[#1a365d] px-1 py-1.5 text-[7.5px] font-bold text-white">
                <div className="w-[22%] text-left">Oinarria / Base</div>
                <div className="w-[38%] text-center">BEZa / IVA</div>
                <div className="w-[20%] text-center">Errekargua / Recargo</div>
                <div className="w-[20%] text-right">Guztira / Total</div>
              </div>
              <div className="flex flex-row border-t border-neutral-300 px-1 py-2 text-[8.5px]">
                <div className="w-[22%] tabular-nums">{fmtEuroEs(subtotal)}</div>
                <div className="w-[38%] text-center tabular-nums">21% — {fmtEuroEs(iva)}</div>
                <div className="w-[20%] text-center tabular-nums">{fmtEuroEs(0)}</div>
                <div className="w-[20%] text-right text-[10px] font-bold tabular-nums">
                  {fmtEuroEs(total)}
                </div>
              </div>
            </div>

            <div className="ml-auto mt-3 w-[48%] text-[8.5px]">
              <div className="flex justify-between gap-2">
                <span>Zerga oinarria / Base imponible:</span>
                <span className="tabular-nums">{fmtEuroEs(subtotal)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>BEZ Kuota / Cuota IVA:</span>
                <span className="tabular-nums">{fmtEuroEs(iva)}</span>
              </div>
              <div className="mt-1 flex justify-between border-t border-black pt-1 text-[10px] font-bold">
                <span>Zenbateko osoa / Importe total:</span>
                <span className="tabular-nums">{fmtEuroEs(total)}</span>
              </div>
            </div>

            <div className="mt-4 border-t border-neutral-200 pt-3 text-[8.5px] leading-snug">
              <p className="mb-1 font-bold text-[10px]">Cuentas bancarias</p>
              <p>KUTXABANK: ES63 2095 5086 1091 2060 8015</p>
              <p>BANCO SABADELL: ES40 0081 4332 4000 0111 1021</p>
            </div>
            <p className="mt-4 text-center text-[8.5px] font-bold">www.pinoalbanileria.net</p>
            <p className="text-center text-[8.5px] text-neutral-600">Software: Perfilio</p>

            {error || localError ? (
              <p className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-[11px] text-red-900">
                {error || localError}
              </p>
            ) : null}
            {saved && !error && !localError ? (
              <p className="mt-4 rounded border border-green-300 bg-green-50 px-3 py-2 text-[11px] text-green-900">
                Cambios guardados. Ya puedes generar el PDF actualizado.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="pointer-events-none fixed bottom-0 left-0 right-0 flex justify-end p-6">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="pointer-events-auto rounded-lg bg-[#ed8936] px-5 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-[#dd6b20] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
}
