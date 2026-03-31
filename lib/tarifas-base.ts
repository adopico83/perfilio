/** Tarifas orientativas de mercado (España, 2024–2025) como respaldo si el negocio no tiene tabla propia. */
export const TARIFAS_BASE_ALBANILERIA = [
  { nombre: 'Solado de gres/cerámica', unidad: 'm2', precio: 35, categoria: 'suelo' },
  { nombre: 'Alicatado de azulejo', unidad: 'm2', precio: 32, categoria: 'alicatado' },
  { nombre: 'Enfoscado de cemento', unidad: 'm2', precio: 18, categoria: 'enfoscado' },
  { nombre: 'Pintura interior', unidad: 'm2', precio: 8, categoria: 'pintura' },
  { nombre: 'Tabique de ladrillo', unidad: 'm2', precio: 45, categoria: 'tabique' },
  { nombre: 'Demolición/picado', unidad: 'm2', precio: 15, categoria: 'demolicion' },
  { nombre: 'Escombro retirada', unidad: 'm3', precio: 80, categoria: 'demolicion' },
  { nombre: 'Fontanería básica', unidad: 'ud', precio: 120, categoria: 'fontaneria' },
  { nombre: 'Mano de obra general', unidad: 'hora', precio: 25, categoria: 'mano_obra' },
  { nombre: 'Falso techo de pladur', unidad: 'm2', precio: 42, categoria: 'techo' },
  { nombre: 'Solera de hormigón', unidad: 'm2', precio: 28, categoria: 'suelo' },
  { nombre: 'Impermeabilización', unidad: 'm2', precio: 25, categoria: 'impermeabilizacion' },
] as const;
