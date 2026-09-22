'use client';

import { useEffect, useState } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { createClient } from '@/lib/supabase/client';
import { pickHoy, type HoyCta, type HoyObra, type HoyPresupuesto } from '@/lib/hoy';
import HoyDemoHome, { type HoyCliente } from '@/components/dashboard/hoy-demo-home';

type ObraRow = {
  id: string;
  nombre: string;
  estado: string | null;
  direccion: string | null;
  cliente_id: string | null;
};

export default function DemoHoyPage({
  onAbrirObra,
}: {
  onAbrirObra?: (obraId: string) => void;
}) {
  const { businessId } = useSession();
  const [loading, setLoading] = useState(true);
  const [clientes, setClientes] = useState<HoyCliente[]>([]);
  const [obra, setObra] = useState<HoyObra | null>(null);
  const [presupuesto, setPresupuesto] = useState<HoyPresupuesto | null>(null);
  const [cta, setCta] = useState<HoyCta | null>(null);

  useEffect(() => {
    if (!businessId) {
      setClientes([]);
      setObra(null);
      setPresupuesto(null);
      setCta(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    void (async () => {
      setLoading(true);
      const [obrasRes, clientesRes, presupuestosRes] = await Promise.all([
        supabase
          .from('obras')
          .select('id, nombre, estado, direccion, cliente_id')
          .eq('business_id', businessId),
        supabase.from('clientes').select('id, nombre').eq('business_id', businessId).order('nombre'),
        supabase
          .from('presupuestos')
          .select('id, estado, obra_id, importe_total, cliente_nombre, presupuesto_generado')
          .eq('business_id', businessId),
      ]);
      if (cancelled) return;

      const clientesRows = (!clientesRes.error && clientesRes.data ? clientesRes.data : []) as HoyCliente[];
      const nombres = new Map(clientesRows.map((c) => [c.id, c.nombre]));
      const obras = (!obrasRes.error && obrasRes.data ? (obrasRes.data as ObraRow[]) : []).map(
        (o): HoyObra => ({
          id: o.id,
          nombre: o.nombre,
          estado: o.estado,
          direccion: o.direccion,
          cliente_nombre: o.cliente_id ? nombres.get(o.cliente_id) ?? null : null,
        })
      );
      const presupuestos = (
        !presupuestosRes.error && presupuestosRes.data ? presupuestosRes.data : []
      ) as HoyPresupuesto[];
      const hoy = pickHoy(obras, presupuestos);

      setClientes(clientesRows);
      setObra(hoy.obra);
      setPresupuesto(hoy.presupuesto);
      setCta(hoy.cta);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  return (
    <HoyDemoHome
      loading={loading}
      clientes={clientes}
      obra={obra}
      presupuesto={presupuesto}
      cta={cta}
      onAbrirObra={onAbrirObra}
    />
  );
}
