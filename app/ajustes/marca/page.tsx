'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { X } from 'lucide-react';
import LogoutButton from '@/app/dashboard/logout-button';
import DashboardMainNav from '@/components/dashboard/dashboard-main-nav';
import { useDemoTenant } from '@/lib/use-demo-tenant';
import {
  DEMO_EMPRESA,
  DEMO_EMPRESA_EMISOR,
  DEMO_MARCA,
  DEMO_MOCK_ENABLED,
  getDemoPresupuestos,
} from '@/lib/demo-data';
import { DEFECTO_FACTURA, DEFECTO_PRESUPUESTO, OBSERVACIONES_PRESUPUESTO_DEFECTO, TIPOGRAFIAS } from '@/lib/pdf/marca';

type Form = {
  razon_social: string;
  nif: string;
  rea: string;
  direccion_fiscal: string;
  localidad_fiscal: string;
  telefono: string;
  email: string;
  web: string;
  instagram: string;
  iban: string;
  marca_color_primario: string;
  marca_color_secundario: string;
  marca_tipografia: string;
  marca_observaciones_presupuesto: string;
};

const FORM_VACIO: Form = {
  razon_social: '',
  nif: '',
  rea: '',
  direccion_fiscal: '',
  localidad_fiscal: '',
  telefono: '',
  email: '',
  web: '',
  instagram: '',
  iban: '',
  marca_color_primario: '',
  marca_color_secundario: '',
  marca_tipografia: '',
  marca_observaciones_presupuesto: '',
};

const FISCALES: Array<{ clave: keyof Form; etiqueta: string; area?: boolean }> = [
  { clave: 'razon_social', etiqueta: 'Razón social' },
  { clave: 'nif', etiqueta: 'NIF' },
  { clave: 'rea', etiqueta: 'R.E.A.' },
  { clave: 'direccion_fiscal', etiqueta: 'Dirección fiscal' },
  { clave: 'localidad_fiscal', etiqueta: 'C.P. y localidad' },
  { clave: 'telefono', etiqueta: 'Teléfono' },
  { clave: 'email', etiqueta: 'Email' },
  { clave: 'web', etiqueta: 'Web' },
  { clave: 'instagram', etiqueta: 'Instagram' },
  { clave: 'iban', etiqueta: 'Cuentas bancarias (una por línea)', area: true },
];

const campoClase =
  'mt-1 w-full rounded-lg border border-zinc-400/50 bg-[#E5DFD0] px-3 py-2 text-base disabled:opacity-60';

function formDemo(): Form {
  const e = DEMO_EMPRESA_EMISOR;
  return {
    ...FORM_VACIO,
    razon_social: e.razonSocial ?? '',
    direccion_fiscal: e.direccion ?? '',
    localidad_fiscal: e.localidad ?? '',
    telefono: e.telefono ?? '',
    email: e.email ?? '',
    marca_color_primario: DEMO_MARCA.colorPrimario ?? '',
    marca_color_secundario: DEMO_MARCA.colorSecundario ?? '',
    marca_tipografia: DEMO_MARCA.tipografia ?? '',
  };
}

export default function AjustesMarcaPage() {
  const router = useRouter();
  const demo = useDemoTenant() && DEMO_MOCK_ENABLED;
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  );

  const [authChecking, setAuthChecking] = useState(true);
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);
  const [form, setForm] = useState<Form>(FORM_VACIO);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [subiendoLogo, setSubiendoLogo] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  useEffect(() => {
    let cancelado = false;
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      if (cancelado) return;
      setAuthChecking(false);

      if (demo) {
        setForm(formDemo());
        setCargando(false);
        return;
      }
      try {
        const res = await fetch('/api/negocio/marca', { credentials: 'include' });
        const json = (await res.json()) as {
          business_id?: string;
          ajustes?: Record<string, string | null>;
          logo_url_firmada?: string | null;
          error?: string;
        };
        if (cancelado) return;
        if (!res.ok) {
          setAviso({ tipo: 'error', texto: json.error ?? 'No se pudieron cargar los ajustes' });
          return;
        }
        setBusinessId(json.business_id ?? null);
        const next = { ...FORM_VACIO };
        for (const k of Object.keys(next) as Array<keyof Form>) next[k] = json.ajustes?.[k] ?? '';
        setForm(next);
        setLogoUrl(json.logo_url_firmada ?? null);
      } catch {
        if (!cancelado) setAviso({ tipo: 'error', texto: 'Error de conexión al cargar los ajustes' });
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [router, supabase, demo]);

  const cambiar = (clave: keyof Form, valor: string) => setForm((f) => ({ ...f, [clave]: valor }));

  const guardar = async () => {
    setGuardando(true);
    setAviso(null);
    try {
      const res = await fetch('/api/negocio/marca', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        // Campo vacío = quitar el valor (vuelve al aspecto de siempre).
        body: JSON.stringify({ business_id: businessId, ...form }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setAviso(
        res.ok
          ? { tipo: 'ok', texto: 'Cambios guardados. Los próximos PDF ya salen con tu marca.' }
          : { tipo: 'error', texto: json.error ?? 'No se pudieron guardar los cambios' }
      );
    } catch {
      setAviso({ tipo: 'error', texto: 'Error de conexión al guardar' });
    } finally {
      setGuardando(false);
    }
  };

  const subirLogo = async (file: File | undefined) => {
    if (!file) return;
    setSubiendoLogo(true);
    setAviso(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (businessId) fd.append('business_id', businessId);
      const res = await fetch('/api/negocio/logo', { method: 'POST', body: fd, credentials: 'include' });
      const json = (await res.json().catch(() => ({}))) as { error?: string; logo_url_firmada?: string | null };
      if (!res.ok) {
        setAviso({ tipo: 'error', texto: json.error ?? 'No se pudo subir el logo' });
        return;
      }
      setLogoUrl(json.logo_url_firmada ?? null);
      setAviso({ tipo: 'ok', texto: 'Logo actualizado.' });
    } catch {
      setAviso({ tipo: 'error', texto: 'Error de conexión al subir el logo' });
    } finally {
      setSubiendoLogo(false);
    }
  };

  // En la demo el PDF de muestra es un presupuesto del mock, con la marca de ejemplo (DEMO_MARCA).
  const hrefMuestra = demo
    ? `/api/demo/pdf/presupuesto/${encodeURIComponent(getDemoPresupuestos()[0]?.id ?? '')}`
    : businessId
      ? `/api/pdf/muestra?business_id=${encodeURIComponent(businessId)}`
      : '/api/pdf/muestra';

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#EFEADF] flex items-center justify-center text-zinc-900">
        Cargando…
      </div>
    );
  }

  const lectura = demo || cargando;

  return (
    <div className="min-h-screen bg-[#EFEADF] text-zinc-900">
      <DashboardMainNav
        brand={
          <Link href="/dashboard" className="text-zinc-900 font-bold text-xl sm:text-2xl truncate shrink-0 min-w-0 max-w-[min(220px,46vw)]">
            {demo ? DEMO_EMPRESA.nombre : 'Perfilio'}
          </Link>
        }
        menuMovilAbierto={menuMovilAbierto}
        setMenuMovilAbierto={setMenuMovilAbierto}
        active="ajustes"
        desktopTrailing={<LogoutButton />}
        mobileDrawerFooter={<LogoutButton />}
      />

      {/* Salida de la pantalla: «← Volver» arriba a la izquierda y, en móvil, una X arriba a la derecha.
          Los dos van al dashboard (la misma ruta que el logo/«Inicio» del menú) y se ven también en la demo. */}
      <div className="max-w-3xl mx-auto flex items-center justify-between px-6 pt-3 pb-1">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 rounded-lg border border-[#A04A2F] px-4 py-2 text-sm font-medium text-[#A04A2F] transition-colors hover:bg-[#A04A2F]/10"
        >
          <span aria-hidden>←</span> Volver
        </Link>
        <Link
          href="/dashboard"
          aria-label="Cerrar y volver al dashboard"
          className="md:hidden inline-flex size-10 items-center justify-center rounded-lg border border-zinc-400/40 text-zinc-800 transition-colors hover:bg-zinc-900/5"
        >
          <X className="size-5" aria-hidden />
        </Link>
      </div>

      <main className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">
            Ajustes de <span className="text-[#A04A2F]">marca</span>
          </h1>
          <p className="text-sm text-zinc-600 mt-1">
            Tus datos fiscales, tu logo y tus colores salen en los PDF de presupuestos y facturas. Lo que dejes
            vacío usa el aspecto de siempre.
          </p>
        </div>

        {demo ? (
          <p className="rounded-lg border border-zinc-400/40 bg-[#E5DFD0] p-3 text-sm">
            Modo demo: solo lectura. Aquí ves la marca del estudio de ejemplo; no se guarda nada.
          </p>
        ) : null}

        {aviso ? (
          <p
            role={aviso.tipo === 'error' ? 'alert' : 'status'}
            className={`rounded-lg border p-3 text-sm ${
              aviso.tipo === 'error'
                ? 'border-[#A04A2F]/50 bg-[#E5DFD0] text-[#A04A2F]'
                : 'border-[#5a7a4a]/50 bg-[#E5DFD0] text-[#3f5a33]'
            }`}
          >
            {aviso.texto}
          </p>
        ) : null}

        <section className="rounded-xl border border-zinc-400/40 bg-[#D4CCBC] p-5 space-y-4" aria-label="Datos fiscales">
          <h2 className="text-lg font-bold">Datos fiscales</h2>
          {FISCALES.map(({ clave, etiqueta, area }) => (
            <div key={clave}>
              <label htmlFor={`aj-${clave}`} className="text-sm font-semibold">
                {etiqueta}
              </label>
              {area ? (
                <textarea
                  id={`aj-${clave}`}
                  rows={3}
                  value={form[clave]}
                  disabled={lectura}
                  onChange={(e) => cambiar(clave, e.target.value)}
                  className={campoClase}
                />
              ) : (
                <input
                  id={`aj-${clave}`}
                  value={form[clave]}
                  disabled={lectura}
                  onChange={(e) => cambiar(clave, e.target.value)}
                  className={campoClase}
                />
              )}
            </div>
          ))}
        </section>

        <section className="rounded-xl border border-zinc-400/40 bg-[#D4CCBC] p-5 space-y-4" aria-label="Logo">
          <h2 className="text-lg font-bold">Logo</h2>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo actual" className="max-h-20 object-contain" />
          ) : (
            <p className="text-sm text-zinc-600">{demo ? 'El logo de la demo se aplica automáticamente.' : 'Aún no has subido ningún logo.'}</p>
          )}
          {!demo ? (
            <div>
              <label
                htmlFor="aj-logo"
                className="inline-flex cursor-pointer items-center rounded-lg bg-[#A04A2F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#8a3f28]"
              >
                {subiendoLogo ? 'Subiendo…' : 'Subir logo (PNG, JPEG o WebP, máx. 2 MB)'}
              </label>
              <input
                id="aj-logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={lectura || subiendoLogo}
                onChange={(e) => {
                  void subirLogo(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-zinc-400/40 bg-[#D4CCBC] p-5 space-y-4" aria-label="Colores y tipografía">
          <h2 className="text-lg font-bold">Colores y tipografía</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="aj-color1" className="text-sm font-semibold">
                Color primario (cabeceras y títulos)
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="aj-color1"
                  type="color"
                  value={form.marca_color_primario || DEFECTO_PRESUPUESTO.primario}
                  disabled={lectura}
                  onChange={(e) => cambiar('marca_color_primario', e.target.value)}
                  className="h-10 w-16 rounded border border-zinc-400/50"
                />
                <button
                  type="button"
                  disabled={lectura || !form.marca_color_primario}
                  onClick={() => cambiar('marca_color_primario', '')}
                  className="text-sm underline disabled:opacity-40"
                >
                  Quitar (usar el de siempre)
                </button>
              </div>
              <p className="mt-1 text-xs text-zinc-600">
                {form.marca_color_primario ? form.marca_color_primario : `Sin elegir: ${DEFECTO_PRESUPUESTO.primario} (presupuestos) / ${DEFECTO_FACTURA.primario} (facturas)`}
              </p>
            </div>
            <div>
              <label htmlFor="aj-color2" className="text-sm font-semibold">
                Color secundario (fondos de cajas y filas)
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="aj-color2"
                  type="color"
                  value={form.marca_color_secundario || DEFECTO_FACTURA.fondoCaja}
                  disabled={lectura}
                  onChange={(e) => cambiar('marca_color_secundario', e.target.value)}
                  className="h-10 w-16 rounded border border-zinc-400/50"
                />
                <button
                  type="button"
                  disabled={lectura || !form.marca_color_secundario}
                  onClick={() => cambiar('marca_color_secundario', '')}
                  className="text-sm underline disabled:opacity-40"
                >
                  Quitar (usar el de siempre)
                </button>
              </div>
              <p className="mt-1 text-xs text-zinc-600">{form.marca_color_secundario || 'Sin elegir: el de siempre'}</p>
            </div>
          </div>
          <div>
            <label htmlFor="aj-tipografia" className="text-sm font-semibold">
              Tipografía
            </label>
            <select
              id="aj-tipografia"
              value={form.marca_tipografia}
              disabled={lectura}
              onChange={(e) => cambiar('marca_tipografia', e.target.value)}
              className={campoClase}
            >
              <option value="">De siempre (Helvetica)</option>
              {TIPOGRAFIAS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="aj-obs" className="text-sm font-semibold">
              Observaciones de los presupuestos
            </label>
            <textarea
              id="aj-obs"
              rows={4}
              maxLength={1000}
              value={form.marca_observaciones_presupuesto}
              disabled={lectura}
              placeholder={OBSERVACIONES_PRESUPUESTO_DEFECTO}
              onChange={(e) => cambiar('marca_observaciones_presupuesto', e.target.value)}
              className={campoClase}
            />
            <p className="mt-1 text-xs text-zinc-600">Si lo dejas vacío se usa el texto estándar (el que ves en gris).</p>
          </div>
        </section>

        <div className="flex flex-wrap gap-3">
          {!demo ? (
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={lectura || guardando}
              className="rounded-lg bg-[#5a7a4a] px-5 py-3 text-base font-semibold text-white hover:bg-[#4d6b40] disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : 'Guardar cambios'}
            </button>
          ) : null}
          <a
            href={hrefMuestra}
            className="inline-flex items-center rounded-lg bg-[#A04A2F] px-5 py-3 text-base font-semibold text-white hover:bg-[#8a3f28]"
          >
            Descargar PDF de muestra
          </a>
        </div>
        {!demo ? (
          <p className="text-xs text-zinc-600">
            El PDF de muestra usa lo que tengas <strong>guardado</strong>: guarda antes de descargarlo.
          </p>
        ) : null}
      </main>
    </div>
  );
}
