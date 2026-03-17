'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { jsPDF } from 'jspdf';
import { X } from 'lucide-react';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Factura {
  id: string;
  business_id: string;
  numero_factura: string | null;
  cliente_nombre: string | null;
  cliente_direccion: string | null;
  cliente_nif: string | null;
  descripcion_trabajos: string | null;
  lineas: unknown;
  base_imponible: number | string | null;
  iva: number | string | null;
  total: number | string | null;
  fecha: string | null;
  fecha_vencimiento: string | null;
  estado: string | null;
  observaciones: string | null;
  created_at: string;
}

export default function FacturasPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authChecking, setAuthChecking] = useState(true);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [detalleId, setDetalleId] = useState<string | null>(null);

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

  const loadFacturas = async () => {
    const { data } = await supabase
      .from('facturas')
      .select(
        'id, business_id, numero_factura, cliente_nombre, cliente_direccion, cliente_nif, descripcion_trabajos, lineas, base_imponible, iva, total, fecha, fecha_vencimiento, estado, observaciones, created_at'
      )
      .order('created_at', { ascending: false });
    setFacturas((data ?? []) as Factura[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!authChecking) loadFacturas();
  }, [authChecking]);

  const setEstado = async (id: string, estado: string) => {
    await supabase.from('facturas').update({ estado }).eq('id', id);
    loadFacturas();
    setDetalleId(null);
  };

  const badgeEstado = (estado: string | null) => {
    const s = (estado ?? '').toLowerCase();
    if (s === 'pagada') {
      return (
        <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-green-600/80 text-white">
          Pagada
        </span>
      );
    }
    if (s === 'vencida') {
      return (
        <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-red-600/80 text-white">
          Vencida
        </span>
      );
    }
    return (
      <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-yellow-400/80 text-yellow-900">
        Pendiente
      </span>
    );
  };

  const descargarPDF = async (f: Factura) => {
    const { data: biz } = await supabase
      .from('business_profiles')
      .select('nombre')
      .eq('id', f.business_id)
      .single();
    const nombreNegocio = (biz as { nombre?: string } | null)?.nombre ?? 'Negocio';
    const fechaStr = f.fecha ?? new Date(f.created_at).toISOString().split('T')[0];

    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const margin = 20;
    const pageW = 210;
    const pageH = 297;
    let y = margin;

    doc.setFontSize(18);
    doc.setTextColor(26, 54, 93);
    doc.text('FACTURA', margin, y);
    y += 10;

    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text(`Fecha: ${fechaStr}`, margin, y);
    y += 6;
    doc.text(`Vencimiento: ${f.fecha_vencimiento ?? ''}`, margin, y);
    y += 6;
    doc.text(`Número: ${f.numero_factura ?? ''}`, margin, y);
    y += 6;
    doc.text(`Cliente: ${f.cliente_nombre ?? ''}`, margin, y);
    y += 6;
    doc.text(`Dirección: ${f.cliente_direccion ?? ''}`, margin, y);
    y += 6;
    doc.text(`NIF: ${f.cliente_nif ?? ''}`, margin, y);
    y += 10;

    const base = Number(f.base_imponible ?? 0);
    const iva = Number(f.iva ?? base * 0.21);
    const total = Number(f.total ?? base + iva);

    doc.text(`Base imponible: ${base.toFixed(2)} €`, margin, y);
    y += 6;
    doc.text(`IVA (21%): ${iva.toFixed(2)} €`, margin, y);
    y += 6;
    doc.text(`Total: ${total.toFixed(2)} €`, margin, y);
    y += 10;

    const descripcion = f.descripcion_trabajos ?? '';
    const maxW = pageW - margin * 2;
    const lineHeight = 6;
    if (descripcion) {
      doc.setFontSize(11);
      const lines = doc.splitTextToSize(descripcion, maxW);
      for (const line of lines) {
        if (y > pageH - margin - 15) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin, y);
        y += lineHeight;
      }
      y += 4;
    }

    if (f.lineas != null) {
      const lineasTxt = JSON.stringify(f.lineas, null, 2);
      const lines = doc.splitTextToSize(lineasTxt, maxW);
      doc.setFontSize(9);
      for (const line of lines) {
        if (y > pageH - margin - 15) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin, y);
        y += lineHeight;
      }
    }

    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text('Generado por Perfilio', margin, pageH - 10);
    }

    doc.save(`factura-${fechaStr}.pdf`);
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <p className="text-white">Comprobando sesión...</p>
      </div>
    );
  }

  const detalleItem = detalleId ? facturas.find((f) => f.id === detalleId) : null;

  return (
    <div className="min-h-screen bg-[#0f172a] text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-white">Historial de facturas</h1>
          <Link
            href="/dashboard"
            className="text-[#ed8936] hover:text-[#f6ad55] text-sm font-medium transition-colors"
          >
            ← Volver al dashboard
          </Link>
        </div>

        {loading ? (
          <p className="text-white/70">Cargando...</p>
        ) : (
          <ul className="space-y-4">
            {facturas.map((f) => (
              <li key={f.id} className="bg-[#1a365d] border border-white/10 rounded-lg p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="space-y-1 text-sm">
                    <p className="font-semibold text-white">
                      {f.numero_factura ?? '—'} — {f.cliente_nombre ?? '—'}
                    </p>
                    <p className="text-white/70">
                      Fecha: {f.fecha ?? new Date(f.created_at).toLocaleDateString('es-ES')}
                    </p>
                    <p className="text-white/70">
                      Vencimiento: {f.fecha_vencimiento ?? '—'}
                    </p>
                  </div>
                  <div className="text-right space-y-1 text-sm">
                    <p className="text-white/80">
                      Base: {f.base_imponible != null ? String(f.base_imponible) : '—'} €
                    </p>
                    <p className="text-white/80">
                      IVA (21%): {f.iva != null ? String(f.iva) : '—'} €
                    </p>
                    <p className="font-semibold">
                      Total: {f.total != null ? String(f.total) : '—'} €
                    </p>
                  </div>
                  <div>{badgeEstado(f.estado)}</div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => setDetalleId(f.id)}
                    className="px-3 py-1.5 text-sm font-medium bg-[#ed8936] hover:bg-[#dd6b20] text-white rounded-lg transition-colors"
                  >
                    Ver detalle completo
                  </button>
                  <button
                    type="button"
                    onClick={() => descargarPDF(f)}
                    className="px-3 py-1.5 text-sm font-medium bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-lg transition-colors"
                  >
                    Descargar PDF
                  </button>
                  {(f.estado ?? 'pendiente').toLowerCase() === 'pendiente' && (
                    <button
                      type="button"
                      onClick={() => setEstado(f.id, 'pagada')}
                      className="px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                    >
                      Marcar pagada
                    </button>
                  )}
                  {(f.estado ?? '').toLowerCase() === 'pendiente' && (
                    <button
                      type="button"
                      onClick={() => setEstado(f.id, 'vencida')}
                      className="px-3 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                    >
                      Marcar vencida
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {!loading && facturas.length === 0 && (
          <p className="text-white/60 text-center py-8">No hay facturas.</p>
        )}
      </div>

      {detalleItem && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDetalleId(null)} aria-hidden />
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden bg-[#1a365d] rounded-xl border border-white/10 shadow-2xl flex flex-col">
            <div className="flex justify-between items-center p-4 border-b border-white/10">
              <h2 className="text-lg font-bold text-white">
                Factura {detalleItem.numero_factura ?? ''}
              </h2>
              <button
                type="button"
                onClick={() => setDetalleId(null)}
                className="p-2 text-white/80 hover:text-white rounded-lg"
                aria-label="Cerrar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 text-sm text-white/90 space-y-2">
              <p>
                <span className="text-white/70">Cliente:</span> {detalleItem.cliente_nombre ?? '—'}
              </p>
              <p>
                <span className="text-white/70">Dirección:</span>{' '}
                {detalleItem.cliente_direccion ?? '—'}
              </p>
              <p>
                <span className="text-white/70">NIF:</span> {detalleItem.cliente_nif ?? '—'}
              </p>
              <p>
                <span className="text-white/70">Base imponible:</span>{' '}
                {detalleItem.base_imponible != null ? String(detalleItem.base_imponible) : '—'} €
              </p>
              <p>
                <span className="text-white/70">IVA:</span>{' '}
                {detalleItem.iva != null ? String(detalleItem.iva) : '—'} €
              </p>
              <p>
                <span className="text-white/70">Total:</span>{' '}
                {detalleItem.total != null ? String(detalleItem.total) : '—'} €
              </p>
              <p>
                <span className="text-white/70">Fecha:</span>{' '}
                {detalleItem.fecha ??
                  new Date(detalleItem.created_at).toLocaleDateString('es-ES')}
              </p>
              <p>
                <span className="text-white/70">Fecha vencimiento:</span>{' '}
                {detalleItem.fecha_vencimiento ?? '—'}
              </p>
              <p>
                <span className="text-white/70">Estado:</span> {badgeEstado(detalleItem.estado)}
              </p>
              {detalleItem.descripcion_trabajos && (
                <p>
                  <span className="text-white/70">Descripción:</span>{' '}
                  {detalleItem.descripcion_trabajos}
                </p>
              )}
              {detalleItem.observaciones && (
                <p>
                  <span className="text-white/70">Observaciones:</span>{' '}
                  {detalleItem.observaciones}
                </p>
              )}
              {detalleItem.lineas != null && (
                <p>
                  <span className="text-white/70">Líneas:</span>{' '}
                  <pre className="mt-1 text-xs overflow-x-auto">
                    {JSON.stringify(detalleItem.lineas, null, 2)}
                  </pre>
                </p>
              )}
            </div>
            <div className="p-4 border-t border-white/10 flex gap-2">
              {(detalleItem.estado ?? 'pendiente').toLowerCase() === 'pendiente' && (
                <>
                  <button
                    type="button"
                    onClick={() => setEstado(detalleItem.id, 'pagada')}
                    className="px-4 py-2 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg"
                  >
                    Marcar pagada
                  </button>
                  <button
                    type="button"
                    onClick={() => setEstado(detalleItem.id, 'vencida')}
                    className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg"
                  >
                    Marcar vencida
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setDetalleId(null)}
                className="px-4 py-2 text-sm font-medium bg-white/10 hover:bg-white/20 text-white rounded-lg"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

