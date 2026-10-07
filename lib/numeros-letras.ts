/**
 * Números escritos con letras («dos enchufes», «tres metros», «ciento veinte», «treinta y cinco») → cifras.
 * Regla general del ejecutor .jev: lo que el usuario DICE con letras cuenta como dicho, igual que las cifras.
 */

const sinTildes = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const UNIDADES: Record<string, number> = {
  cero: 0, uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintiun: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const DECENAS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const CENTENAS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400,
  quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800,
  ochocientas: 800, novecientos: 900, novecientas: 900,
};

type Hallazgo = { valor: number; desde: number; hasta: number };

/** Números en letras del texto, con su posición en la lista de palabras. «un/una/uno» sueltos NO cuentan (son artículos). */
function hallar(palabras: string[]): Hallazgo[] {
  const out: Hallazgo[] = [];
  let i = 0;
  while (i < palabras.length) {
    let j = i;
    let total = 0;
    let miles = 0;
    let hay = false;
    let soloUno = true;
    // [miles] [centenas] [decenas [y unidad] | unidad]
    for (let guard = 0; guard < 6 && j < palabras.length; guard++) {
      const w = palabras[j]!;
      if (w === 'mil') {
        miles = (total || 1) * 1000;
        total = 0;
        hay = true;
        soloUno = false;
        j++;
        continue;
      }
      if (w in CENTENAS && total < 100) {
        total += CENTENAS[w]!;
        hay = true;
        soloUno = false;
        j++;
        continue;
      }
      if (w in DECENAS) {
        total += DECENAS[w]!;
        hay = true;
        soloUno = false;
        j++;
        if (palabras[j] === 'y' && palabras[j + 1] && palabras[j + 1]! in UNIDADES && UNIDADES[palabras[j + 1]!]! >= 1 && UNIDADES[palabras[j + 1]!]! <= 9) {
          total += UNIDADES[palabras[j + 1]!]!;
          j += 2;
        }
        break;
      }
      if (w in UNIDADES) {
        total += UNIDADES[w]!;
        if (!['un', 'una', 'uno'].includes(w)) soloUno = false;
        hay = true;
        j++;
        break;
      }
      break;
    }
    if (hay && !(soloUno && j - i === 1)) out.push({ valor: miles + total, desde: i, hasta: j });
    i = Math.max(j, i + 1);
  }
  return out;
}

const palabrasDe = (texto: string): string[] => sinTildes(texto).split(/[^a-z0-9ñ]+/).filter(Boolean);

/** Todos los números que el texto dice con LETRAS («dos enchufes a treinta y cinco» → [2, 35]). */
export function numerosEnLetras(texto: string): number[] {
  return hallar(palabrasDe(texto)).map((h) => h.valor);
}

/** Texto con los números en letras cambiados por cifras («dos enchufes a treinta y cinco» → «2 enchufes a 35»). */
export function letrasACifras(texto: string): string {
  const palabras = String(texto ?? '').split(/(\s+)/);
  // Se trabaja palabra a palabra conservando los espacios: se mapea índice de palabra «limpia» → índice real.
  const reales: number[] = [];
  const limpias: string[] = [];
  palabras.forEach((p, idx) => {
    const l = sinTildes(p).replace(/[^a-z0-9ñ]/g, '');
    if (l) {
      reales.push(idx);
      limpias.push(l);
    }
  });
  const hs = hallar(limpias);
  const salida = [...palabras];
  for (const h of hs) {
    salida[reales[h.desde]!] = String(h.valor);
    for (let k = h.desde + 1; k < h.hasta; k++) salida[reales[k]!] = '';
  }
  return salida.join('').replace(/\s{2,}/g, ' ').trim();
}
