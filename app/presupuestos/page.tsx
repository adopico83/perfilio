'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { X } from 'lucide-react';
import { jsPDF } from 'jspdf';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Presupuesto {
  id: string;
  business_id: string;
  mensaje_cliente: string | null;
  presupuesto_generado: string | null;
  fecha: string | null;
  estado: string | null;
  created_at: string;
}

export default function PresupuestosPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authChecking, setAuthChecking] = useState(true);
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [modalId, setModalId] = useState<string | null>(null);

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

  const loadPresupuestos = async () => {
    const { data } = await supabase
      .from('presupuestos')
      .select('id, business_id, mensaje_cliente, presupuesto_generado, fecha, estado, created_at')
      .order('created_at', { ascending: false });
    setPresupuestos((data ?? []) as Presupuesto[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!authChecking) loadPresupuestos();
  }, [authChecking]);

  const setEstado = async (id: string, estado: string) => {
    await supabase.from('presupuestos').update({ estado }).eq('id', id);
    loadPresupuestos();
    setModalId(null);
  };

  const resumen = (text: string | null, max = 100) => {
    if (!text) return '—';
    return text.length <= max ? text : text.slice(0, max) + '…';
  };

  const badgeEstado = (estado: string | null) => {
    const s = (estado ?? '').toLowerCase();
    if (s === 'aprobado') return <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-green-600/80 text-white">Aprobado</span>;
    if (s === 'rechazado') return <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-red-600/80 text-white">Rechazado</span>;
    return <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-gray-500/80 text-white">Borrador</span>;
  };

  const descargarPDF = async (p: Presupuesto) => {
    const { data: biz } = await supabase.from('business_profiles').select('nombre').eq('id', p.business_id).single();
    const nombreNegocio = (biz as { nombre?: string } | null)?.nombre ?? 'Negocio';
    const fechaStr = p.fecha ?? new Date(p.created_at).toISOString().split('T')[0];
    const contenido = (p.presupuesto_generado ?? '').replace(/\*\*/g, '').replace(/^[-*]\s/gm, '• ').trim();

    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const margin = 20;
    const pageW = 210;
    const pageH = 297;
    let y = margin;

    doc.setFontSize(18);
    doc.setTextColor(26, 54, 93);
    doc.text('PRESUPUESTO', margin, y);
    y += 10;

    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text(`Fecha: ${fechaStr}`, margin, y);
    y += 6;
    doc.text(`Cliente/Negocio: ${nombreNegocio}`, margin, y);
    y += 10;

    doc.setFontSize(11);
    const lineHeight = 6;
    const maxW = pageW - margin * 2;
    const lines = doc.splitTextToSize(contenido, maxW);
    for (const line of lines) {
      if (y > pageH - margin - 15) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += lineHeight;
    }

    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text('Generado por Perfilio', margin, pageH - 10);
    }

    doc.save(`presupuesto-${fechaStr}.pdf`);
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#1a365d] flex items-center justify-center">
        <p className="text-white">Comprobando sesión...</p>
      </div>
    );
  }

  const modalItem = modalId ? presupuestos.find((p) => p.id === modalId) : null;

  return (
    <div className="min-h-screen bg-[#1a365d] text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-white">Historial de presupuestos</h1>
          <Link href="/dashboard" className="text-[#ed8936] hover:text-[#f6ad55] text-sm font-medium transition-colors">
            ← Volver al dashboard
          </Link>
        </div>

        {loading ? (
          <p className="text-white/70">Cargando...</p>
        ) : (
          <ul className="space-y-4">
            {presupuestos.map((p) => (
              <li key={p.id} className="bg-white/5 border border-white/10 rounded-lg p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="text-white/70 text-sm">{p.fecha ?? new Date(p.created_at).toLocaleDateString('es-ES')}</span>
                  {badgeEstado(p.estado)}
                </div>
                <p className="text-white/90 text-sm mb-3">{resumen(p.mensaje_cliente)}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setModalId(p.id)}
                    className="px-3 py-1.5 text-sm font-medium bg-[#ed8936] hover:bg-[#dd6b20] text-white rounded-lg transition-colors"
                  >
                    Ver presupuesto completo
                  </button>
                  <button
                    type="button"
                    onClick={() => descargarPDF(p)}
                    className="px-3 py-1.5 text-sm font-medium bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-lg transition-colors"
                  >
                    Descargar PDF
                  </button>
                  {(p.estado ?? 'borrador') === 'borrador' && (
                    <>
                      <button type="button" onClick={() => setEstado(p.id, 'aprobado')} className="px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors">Aprobar</button>
                      <button type="button" onClick={() => setEstado(p.id, 'rechazado')} className="px-3 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors">Rechazar</button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {!loading && presupuestos.length === 0 && (
          <p className="text-white/60 text-center py-8">No hay presupuestos.</p>
        )}
      </div>

      {modalItem && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setModalId(null)} aria-hidden />
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden bg-[#1a365d] rounded-xl border border-white/10 shadow-2xl flex flex-col">
            <div className="flex justify-between items-center p-4 border-b border-white/10">
              <h2 className="text-lg font-bold text-white">Presupuesto completo</h2>
              <button type="button" onClick={() => setModalId(null)} className="p-2 text-white/80 hover:text-white rounded-lg" aria-label="Cerrar">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 text-white/90 text-sm leading-relaxed [&>*+*]:mt-3">
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="text-white">{children}</p>,
                  strong: ({ children }) => <strong className="text-[#ed8936] font-bold">{children}</strong>,
                  ul: ({ children }) => <ul className="list-disc pl-6 space-y-1 text-white">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-6 space-y-1 text-white">{children}</ol>,
                  li: ({ children }) => <li className="text-white">{children}</li>,
                }}
              >
                {modalItem.presupuesto_generado ?? ''}
              </ReactMarkdown>
            </div>
            <div className="p-4 border-t border-white/10 flex gap-2">
              {(modalItem.estado ?? 'borrador') === 'borrador' && (
                <>
                  <button type="button" onClick={() => setEstado(modalItem.id, 'aprobado')} className="px-4 py-2 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg">Aprobar</button>
                  <button type="button" onClick={() => setEstado(modalItem.id, 'rechazado')} className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg">Rechazar</button>
                </>
              )}
              <button type="button" onClick={() => setModalId(null)} className="px-4 py-2 text-sm font-medium bg-white/10 hover:bg-white/20 text-white rounded-lg">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
