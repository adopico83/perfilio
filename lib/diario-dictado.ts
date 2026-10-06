/** Obra tal y como la necesita el selector del dictado. */
export type ObraDictado = {
  id: string;
  nombre: string;
  direccion: string | null;
  estado?: string | null;
};

/** Minúsculas y sin tildes, para comparar «Cocina Bárbara» con «cocina barbara». */
export function normalizarTexto(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Junta lo ya escrito con un nuevo dictado (una línea en blanco entre los dos). */
export function anadirDictado(actual: string, nuevo: string): string {
  const a = actual.trim();
  const n = nuevo.trim();
  if (!a) return n;
  if (!n) return a;
  return `${a}\n\n${n}`;
}

const NOMBRE_MIN = 4;

/**
 * Si el texto dictado nombra una obra distinta de la elegida, la devuelve (para preguntar al
 * usuario). Coincidencia simple: el nombre de la obra aparece tal cual en el texto, sin tildes ni
 * mayúsculas. Si el texto también nombra la obra elegida, no hay duda y no se avisa. Entre varias
 * coincidencias gana el nombre más largo (el más específico).
 */
export function detectarObraMencionada(
  texto: string,
  obras: ObraDictado[],
  obraIdElegida: string | null
): ObraDictado | null {
  const t = normalizarTexto(texto);
  if (!t) return null;
  const aparece = (o: ObraDictado) => {
    const n = normalizarTexto(o.nombre);
    return n.length >= NOMBRE_MIN && t.includes(n);
  };
  const elegida = obras.find((o) => o.id === obraIdElegida);
  if (elegida && aparece(elegida)) return null;
  const otras = obras.filter((o) => o.id !== obraIdElegida && aparece(o));
  if (otras.length === 0) return null;
  return otras.sort((a, b) => b.nombre.length - a.nombre.length)[0];
}
