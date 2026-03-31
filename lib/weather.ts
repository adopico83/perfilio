/**
 * OpenWeather — previsión agrupada por día (forecast 5 días / 3 h).
 */

export interface PrediccionMeteo {
  fecha: string;
  descripcion: string;
  temp_min: number;
  temp_max: number;
  lluvia: boolean;
  viento_fuerte: boolean;
  icono: string;
  recomendacion: string;
}

type ForecastItem = {
  dt: number;
  main: { temp: number; temp_min?: number; temp_max?: number };
  weather: Array<{ description?: string; icon?: string; main?: string }>;
  wind?: { speed?: number };
  pop?: number;
  rain?: { '3h'?: number };
};

type ForecastResponse = {
  city?: { timezone?: number };
  list?: ForecastItem[];
};

function getApiKey(): string {
  const k = process.env.OPENWEATHER_API_KEY;
  if (!k || !k.trim()) {
    throw new Error('OPENWEATHER_API_KEY no configurada');
  }
  return k.trim();
}

function formatYmdInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

function addDaysToYmd(ymd: string, days: number): string {
  const [y, mo, da] = ymd.split('-').map(Number);
  const u = Date.UTC(y, mo - 1, da + days);
  return new Date(u).toISOString().slice(0, 10);
}

/** Día civil local en la ciudad (OpenWeather: timezone = offset en s respecto a UTC). */
function dayKeyLocal(dtUtc: number, timezoneSec: number): string {
  const d = new Date((dtUtc + timezoneSec) * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function hayLluvia(it: ForecastItem): boolean {
  const desc = (it.weather[0]?.description ?? '').toLowerCase();
  const main = (it.weather[0]?.main ?? '').toLowerCase();
  if (
    desc.includes('lluvia') ||
    desc.includes('rain') ||
    desc.includes('llovizna') ||
    desc.includes('chubasco') ||
    main.includes('rain')
  ) {
    return true;
  }
  const pop = it.pop ?? 0;
  const rain3h = it.rain?.['3h'] ?? 0;
  return pop > 0.4 || rain3h > 0;
}

function hayTormenta(desc: string, main?: string): boolean {
  const d = desc.toLowerCase();
  const m = (main ?? '').toLowerCase();
  return d.includes('tormenta') || d.includes('thunderstorm') || m.includes('thunderstorm');
}

function recomendacionPara(
  lluvia: boolean,
  vientoFuerte: boolean,
  descripcion: string,
  main?: string
): string {
  if (hayTormenta(descripcion, main)) {
    return 'No recomendado: tormenta';
  }
  if (lluvia) {
    return 'Precaución: lluvia';
  }
  if (vientoFuerte) {
    return 'Precaución: viento fuerte';
  }
  return 'Buenas condiciones';
}

function iconoEmoji(icon: string, lluvia: boolean, vientoFuerte: boolean, tormenta: boolean): string {
  if (tormenta || icon.startsWith('11')) return '⛈️';
  if (lluvia || icon.startsWith('09') || icon.startsWith('10')) return '🌧️';
  if (vientoFuerte) return '🌬️';
  if (icon.startsWith('01')) return '☀️';
  if (icon.startsWith('02') || icon.startsWith('03') || icon.startsWith('04')) return '🌤️';
  return '🌤️';
}

function pickWorstIcon(icons: string[]): string {
  const order = (ic: string) => {
    if (ic.startsWith('11')) return 0;
    if (ic.startsWith('10') || ic.startsWith('09')) return 1;
    return 5;
  };
  return [...icons].sort((a, b) => order(a) - order(b))[0] ?? '02d';
}

function agregarDia(
  items: ForecastItem[],
  timezoneSec: number
): PrediccionMeteo | null {
  if (items.length === 0) return null;
  let tempMin = Infinity;
  let tempMax = -Infinity;
  let lluvia = false;
  let vientoFuerte = false;
  const icons: string[] = [];
  let descPrincipal = items[Math.floor(items.length / 2)]?.weather[0]?.description ?? '';
  let mainPrincipal = items[Math.floor(items.length / 2)]?.weather[0]?.main ?? '';

  for (const it of items) {
    const tmn = it.main.temp_min ?? it.main.temp;
    const tmx = it.main.temp_max ?? it.main.temp;
    tempMin = Math.min(tempMin, tmn);
    tempMax = Math.max(tempMax, tmx);
    if (hayLluvia(it)) lluvia = true;
    if ((it.wind?.speed ?? 0) > 10) vientoFuerte = true;
    const ic = it.weather[0]?.icon ?? '02d';
    icons.push(ic);
    if (hayTormenta(it.weather[0]?.description ?? '', it.weather[0]?.main)) {
      descPrincipal = it.weather[0]?.description ?? descPrincipal;
      mainPrincipal = it.weather[0]?.main ?? mainPrincipal;
    }
  }

  const icon = pickWorstIcon(icons);
  const fecha = dayKeyLocal(items[0].dt, timezoneSec);
  const tormenta = hayTormenta(descPrincipal, mainPrincipal);
  const rec = recomendacionPara(lluvia, vientoFuerte, descPrincipal, mainPrincipal);

  return {
    fecha,
    descripcion: descPrincipal || 'Condiciones variables',
    temp_min: Math.round(tempMin * 10) / 10,
    temp_max: Math.round(tempMax * 10) / 10,
    lluvia,
    viento_fuerte: vientoFuerte,
    icono: iconoEmoji(icon, lluvia, vientoFuerte, tormenta),
    recomendacion: rec,
  };
}

function agruparPorDia(
  list: ForecastItem[],
  timezoneSec: number
): Map<string, ForecastItem[]> {
  const map = new Map<string, ForecastItem[]>();
  for (const it of list) {
    const key = dayKeyLocal(it.dt, timezoneSec);
    const arr = map.get(key) ?? [];
    arr.push(it);
    map.set(key, arr);
  }
  return map;
}

async function fetchForecastJson(url: string): Promise<ForecastResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenWeather: ${res.status} ${t.slice(0, 200)}`);
  }
  return (await res.json()) as ForecastResponse;
}

/**
 * Previsión próximos 2 días (agrupados por día civil local).
 */
export async function getPrediccionPorCiudad(ciudad: string): Promise<PrediccionMeteo[]> {
  const q = ciudad.trim();
  if (!q) return [];
  const key = getApiKey();
  const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(q)}&appid=${key}&units=metric&lang=es&cnt=40`;
  const data = await fetchForecastJson(url);
  return construirPrediccionesDosDias(data);
}

export async function getPrediccionPorCoordenadas(
  lat: number,
  lon: number
): Promise<PrediccionMeteo[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const key = getApiKey();
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${key}&units=metric&lang=es&cnt=40`;
  const data = await fetchForecastJson(url);
  return construirPrediccionesDosDias(data);
}

function construirPrediccionesDosDias(data: ForecastResponse): PrediccionMeteo[] {
  const list = data.list ?? [];
  const tz = data.city?.timezone ?? 0;
  const byDay = agruparPorDia(list, tz);
  const keys = [...byDay.keys()].sort();
  const out: PrediccionMeteo[] = [];
  for (const k of keys.slice(0, 2)) {
    const agg = agregarDia(byDay.get(k) ?? [], tz);
    if (agg) out.push(agg);
  }
  return out;
}

export async function geocodeDireccion(
  direccion: string
): Promise<{ lat: number; lon: number; name: string } | null> {
  const q = direccion.trim();
  if (!q) return null;
  const key = getApiKey();
  const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=1&appid=${key}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const arr = (await res.json()) as Array<{ lat: number; lon: number; name?: string }>;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const g = arr[0];
  return { lat: g.lat, lon: g.lon, name: g.name ?? q };
}

/**
 * Primera jornada con datos (hoy local en la zona del punto).
 */
export async function getPrediccionParaDireccion(
  direccion: string
): Promise<PrediccionMeteo | null> {
  const geo = await geocodeDireccion(direccion);
  if (!geo) return null;
  const preds = await getPrediccionPorCoordenadas(geo.lat, geo.lon);
  return preds[0] ?? null;
}

function etiquetaDiaRelativa(fechaYmd: string): string {
  const hoy = formatYmdInTimeZone(new Date(), 'Europe/Madrid');
  const manana = addDaysToYmd(hoy, 1);
  if (fechaYmd === hoy) return 'Hoy';
  if (fechaYmd === manana) return 'Mañana';
  return fechaYmd;
}

/**
 * Texto listo para el chat (emojis + avisos).
 */
export function formatearMensajeConsultaTiempo(
  preds: PrediccionMeteo[],
  etiquetaUbicacion: string
): string {
  if (preds.length === 0) {
    return 'No hay datos de previsión.';
  }
  const partes: string[] = [];
  for (const p of preds) {
    const cuando = etiquetaDiaRelativa(p.fecha);
    const temp = `${p.temp_min}–${p.temp_max}°C`;
    const extras: string[] = [];
    if (p.lluvia) extras.push('lluvia prevista');
    if (p.viento_fuerte) extras.push('viento fuerte');
    const extraStr = extras.length ? `, ${extras.join(', ')}` : '';
    let linea = `${p.icono} ${cuando} en ${etiquetaUbicacion}: ${p.descripcion}, ${temp}${extraStr}.`;
    const tormenta =
      p.recomendacion.includes('tormenta') ||
      p.descripcion.toLowerCase().includes('tormenta');
    if (tormenta || p.lluvia) {
      linea += ' ⚠️ No recomendado para trabajos en exterior.';
    } else if (p.viento_fuerte) {
      linea += ' ⚠️ Precaución en trabajos en altura o exterior.';
    }
    partes.push(linea);
  }
  return partes.join('\n');
}
