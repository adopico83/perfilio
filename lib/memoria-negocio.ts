import type { SupabaseClient } from '@supabase/supabase-js';

export const MEMORIA_CATEGORIAS = [
  'preferencia_material',
  'correccion_tecnica',
  'proveedor_habitual',
  'preferencia_formato',
  'precio_habitual',
  'dato_negocio',
] as const;

export type MemoriaCategoria = (typeof MEMORIA_CATEGORIAS)[number];

export function esCategoriaMemoriaValida(c: string): c is MemoriaCategoria {
  return (MEMORIA_CATEGORIAS as readonly string[]).includes(c);
}

export function buildMemoriaNegocioPromptBlock(
  rows: Array<{ categoria: string; clave: string; valor_texto: string }>
): string {
  if (!rows.length) return '';
  const lines = rows.map((r) => {
    const cat = String(r.categoria ?? '').trim();
    const clave = String(r.clave ?? '').trim();
    const val = String(r.valor_texto ?? '').trim();
    return `[${cat} - ${clave}]: ${val}`;
  });
  return `\n\n## Lo que sé de este negocio\n${lines.join('\n')}`;
}

export async function upsertMemoriaNegocio(
  supabase: SupabaseClient,
  businessId: string,
  categoria: string,
  clave: string,
  valorTexto: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from('memoria_negocio').upsert(
    {
      business_id: businessId,
      categoria,
      clave,
      valor_texto: valorTexto,
    },
    { onConflict: 'business_id,clave' }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteMemoriaNegocioByClave(
  supabase: SupabaseClient,
  businessId: string,
  clave: string
): Promise<{ ok: true; deleted: boolean } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from('memoria_negocio')
    .delete()
    .eq('business_id', businessId)
    .eq('clave', clave)
    .select('id');
  if (error) return { ok: false, error: error.message };
  return { ok: true, deleted: (data?.length ?? 0) > 0 };
}
