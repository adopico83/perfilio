#!/usr/bin/env node
/**
 * Limpieza puntual de Storage: logos sobrantes y PDF huérfanos.
 *
 *   npm run limpiar:storage                      → SOLO LISTA (no borra nada)
 *   npm run limpiar:storage -- --borrar          → borra de verdad lo que lista
 *   npm run limpiar:storage -- --negocio <uuid>  → solo ese negocio
 *
 * Necesita NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local. No mira `diario-obra`.
 */
import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);
const { clasificarLogo, clasificarPdf, esBorrable, borrarEnLotes } = require('./limpiar-storage-logica.cjs');

dotenv.config({ path: '.env.local' });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local');
  process.exit(1);
}

const args = process.argv.slice(2);
const borrar = args.includes('--borrar');
const i = args.indexOf('--negocio');
const soloNegocio = i >= 0 ? (args[i + 1] ?? '').toLowerCase() : null;
if (i >= 0 && !soloNegocio) {
  console.error('--negocio necesita un uuid');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const PAGINA = 1000;

/** Todas las filas de una tabla (paginando). */
async function leerTodo(tabla, columnas) {
  const filas = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await supabase.from(tabla).select(columnas).range(desde, desde + PAGINA - 1);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    filas.push(...data);
    if (data.length < PAGINA) return filas;
  }
}

/** Lista todos los objetos de un bucket con rutas del tipo carpeta/fichero (un nivel). */
async function listarBucket(bucket) {
  const rutas = [];
  const listar = async (prefijo) => {
    const items = [];
    for (let offset = 0; ; offset += PAGINA) {
      const { data, error } = await supabase.storage.from(bucket).list(prefijo, { limit: PAGINA, offset });
      if (error) throw new Error(`${bucket}/${prefijo}: ${error.message}`);
      items.push(...data);
      if (data.length < PAGINA) return items;
    }
  };
  for (const carpeta of await listar('')) {
    if (carpeta.id) {
      rutas.push(carpeta.name); // fichero suelto en la raíz: ruta rara
      continue;
    }
    for (const f of await listar(carpeta.name)) if (f.id) rutas.push(`${carpeta.name}/${f.name}`);
  }
  return soloNegocio ? rutas.filter((r) => r.toLowerCase().startsWith(`${soloNegocio}/`)) : rutas;
}

function porNegocio(filas) {
  const m = new Map();
  for (const f of filas) {
    const b = String(f.business_id).toLowerCase();
    if (!m.has(b)) m.set(b, new Set());
    m.get(b).add(String(f.id).toLowerCase());
  }
  return m;
}

const resumen = { borrados: 0, fallidos: 0, candidatos: 0 };

async function procesar(bucket, clasificar) {
  const rutas = await listarBucket(bucket);
  const grupos = { sobrante: [], huerfano: [], no_reconocido: [], resto: 0 };
  for (const r of rutas) {
    const c = clasificar(r);
    if (c === 'sobrante' || c === 'huerfano' || c === 'no_reconocido') grupos[c].push(r);
    else grupos.resto += 1;
  }
  console.log(`\n== ${bucket}: ${rutas.length} objetos (${grupos.resto} correctos) ==`);
  for (const [etiqueta, lista] of [['sobrante', grupos.sobrante], ['huérfano', grupos.huerfano], ['no reconocido (NO se borra)', grupos.no_reconocido]]) {
    for (const r of lista) console.log(`  [${etiqueta}] ${r}`);
  }
  const aBorrar = [...grupos.sobrante, ...grupos.huerfano].filter((r) => esBorrable(clasificar(r)));
  resumen.candidatos += aBorrar.length;
  if (borrar && aBorrar.length > 0) {
    console.log(`  Borrando ${aBorrar.length} objeto(s)…`);
    const r = await borrarEnLotes(supabase.storage, bucket, aBorrar, { borrar: true, lote: 100 });
    resumen.borrados += r.borrados;
    resumen.fallidos += r.fallidos;
  }
}

console.log(borrar ? 'MODO BORRAR: se borrará lo listado.' : 'Modo solo listar: no se borra nada (usa --borrar para borrar).');
const perfiles = new Map((await leerTodo('business_profiles', 'id, logo_url')).map((p) => [String(p.id).toLowerCase(), p.logo_url]));
await procesar('business-assets', (r) => clasificarLogo(r, perfiles));
const presupuestos = porNegocio(await leerTodo('presupuestos', 'id, business_id'));
await procesar('presupuestos-pdf', (r) => clasificarPdf(r, presupuestos));
const facturas = porNegocio(await leerTodo('facturas', 'id, business_id'));
await procesar('facturas-pdf', (r) => clasificarPdf(r, facturas));

console.log(
  borrar
    ? `\nBorrados: ${resumen.borrados}. Fallidos: ${resumen.fallidos}.`
    : `\n${resumen.candidatos} objeto(s) se borrarían con --borrar.`
);
process.exit(resumen.fallidos > 0 ? 1 : 0);
