'use client';

import { useEffect, useState } from 'react';

type Estado = {
  resumen_push: boolean;
  pushover_configurado: boolean;
  pushover_clave_final: string | null;
  usa_clave_global: boolean;
};

const campoClase =
  'mt-1 w-full rounded-lg border border-zinc-400/50 bg-[#E5DFD0] px-3 py-2 text-base disabled:opacity-60';

/** Sección «Avisos al móvil» de Ajustes: resumen del día por Pushover. En demo se ve pero no hace nada. */
export default function AvisosMovil({ demo, businessId }: { demo: boolean; businessId: string | null }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [clave, setClave] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  // GET y PATCH trabajan SIEMPRE sobre el mismo negocio (el activo en Ajustes): `business_id` va en los dos.
  const urlGet = businessId ? `/api/negocio/avisos?business_id=${encodeURIComponent(businessId)}` : null;

  useEffect(() => {
    // Hasta saber el negocio no se llama a nada (los controles siguen bloqueados).
    if (demo || !urlGet) return;
    let cancelado = false;
    void (async () => {
      try {
        const res = await fetch(urlGet, { credentials: 'include' });
        const json = (await res.json().catch(() => ({}))) as Partial<Estado> & { error?: string };
        if (cancelado) return;
        if (!res.ok) {
          setAviso({ tipo: 'error', texto: json.error ?? 'No se pudieron cargar los avisos al móvil' });
          return;
        }
        setEstado({
          resumen_push: json.resumen_push === true,
          pushover_configurado: json.pushover_configurado === true,
          pushover_clave_final: json.pushover_clave_final ?? null,
          usa_clave_global: json.usa_clave_global === true,
        });
      } catch {
        if (!cancelado) setAviso({ tipo: 'error', texto: 'Error de conexión al cargar los avisos al móvil' });
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [demo, urlGet]);

  const guardar = async (cambios: { resumen_push?: boolean; pushover_user_key?: string | null }, ok: string) => {
    setGuardando(true);
    setAviso(null);
    try {
      const res = await fetch('/api/negocio/avisos', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, ...cambios }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; aviso?: string };
      if (!res.ok) {
        setAviso({ tipo: 'error', texto: json.error ?? 'No se pudieron guardar los cambios' });
        return;
      }
      setAviso({ tipo: 'ok', texto: json.aviso ? `${ok} ${json.aviso}` : ok });
      setClave('');
      const recarga = await fetch(urlGet ?? '/api/negocio/avisos', { credentials: 'include' });
      if (recarga.ok) setEstado((await recarga.json()) as Estado);
    } catch {
      setAviso({ tipo: 'error', texto: 'Error de conexión al guardar' });
    } finally {
      setGuardando(false);
    }
  };

  const bloqueado = demo || guardando || (!estado && !aviso);

  return (
    <section className="rounded-xl border border-zinc-400/40 bg-[#D4CCBC] p-5 space-y-4" aria-label="Avisos al móvil">
      <h2 className="text-lg font-bold">Avisos al móvil</h2>
      {demo ? <p className="text-sm text-zinc-700">Modo demo: aquí se configuran los avisos al móvil; no se guarda nada.</p> : null}

      {aviso ? (
        <p
          role={aviso.tipo === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border p-3 text-sm ${
            aviso.tipo === 'error' ? 'border-[#A04A2F]/50 bg-[#E5DFD0] text-[#A04A2F]' : 'border-[#5a7a4a]/50 bg-[#E5DFD0] text-[#3f5a33]'
          }`}
        >
          {aviso.texto}
        </p>
      ) : null}

      <label className="flex items-center gap-3 text-sm font-semibold">
        <input
          type="checkbox"
          role="switch"
          checked={estado?.resumen_push ?? false}
          disabled={bloqueado}
          onChange={(e) => void guardar({ resumen_push: e.target.checked }, e.target.checked ? 'Aviso activado.' : 'Aviso desactivado.')}
          className="size-5 accent-[#A04A2F]"
        />
        Mandarme el resumen del día al móvil
      </label>

      <div>
        <label htmlFor="aj-pushover" className="text-sm font-semibold">
          Clave de usuario de Pushover
        </label>
        <input
          id="aj-pushover"
          type="password"
          autoComplete="off"
          value={clave}
          disabled={bloqueado}
          placeholder={estado?.pushover_clave_final ?? (estado?.usa_clave_global ? 'Usas la clave general' : '30 letras y números')}
          onChange={(e) => setClave(e.target.value)}
          className={campoClase}
        />
        <p className="mt-1 text-xs text-zinc-600">
          La encuentras en la app de Pushover (pantalla principal, «Your User Key»). Solo la ve el servidor.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={bloqueado || clave.trim().length === 0}
            onClick={() => void guardar({ pushover_user_key: clave.trim() }, 'Clave guardada.')}
            className="rounded-lg bg-[#A04A2F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#8a3f28] disabled:opacity-50"
          >
            Guardar clave
          </button>
          <button
            type="button"
            disabled={bloqueado || !estado?.pushover_clave_final}
            onClick={() => void guardar({ pushover_user_key: null }, 'Clave quitada.')}
            className="rounded-lg border border-zinc-400/60 px-4 py-2 text-sm font-medium hover:bg-zinc-900/5 disabled:opacity-50"
          >
            Quitar clave
          </button>
        </div>
      </div>
    </section>
  );
}
