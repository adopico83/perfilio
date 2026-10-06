import { borrarEnLotes, clasificarLogo, clasificarPdf, esBorrable } from '../scripts/limpiar-storage-logica.cjs';

const A = '8784450e-08a4-420a-8c37-d30bff8f0d39';
const B = '900ed462-7640-4893-9030-a41163219f7a';
const P1 = '0ecdbd0f-d46e-48fa-90c7-9a3947da8444';
const P2 = '11111111-d46e-48fa-90c7-9a3947da8444';

describe('clasificarLogo', () => {
  const perfiles = new Map<string, string | null>([[A, `${A}/logo-2.png`], [B, null]]);
  it('el logo vigente no se toca, el viejo sobra', () => {
    expect(clasificarLogo(`${A}/logo-2.png`, perfiles)).toBe('vigente');
    expect(clasificarLogo(`${A}/logo-1.png`, perfiles)).toBe('sobrante');
  });
  it('un negocio sin logo vigente: todo lo suyo sobra', () => {
    expect(clasificarLogo(`${B}/logo-1.png`, perfiles)).toBe('sobrante');
  });
  it('carpeta de un negocio que no existe = huérfano', () => {
    expect(clasificarLogo('22222222-0000-4000-8000-000000000001/x.png', perfiles)).toBe('huerfano');
  });
  it('ruta con otro formato = no reconocido y nunca borrable', () => {
    expect(clasificarLogo('suelto.png', perfiles)).toBe('no_reconocido');
    expect(clasificarLogo(`${A}/a/b.png`, perfiles)).toBe('no_reconocido');
    expect(esBorrable('no_reconocido')).toBe(false);
  });
});

describe('clasificarPdf', () => {
  const docs = new Map([[A, new Set([P1])], [B, new Set([P2])]]);
  it('PDF con fila del mismo negocio no se toca', () => {
    expect(clasificarPdf(`${A}/${P1}.pdf`, docs)).toBe('ok');
  });
  it('PDF cuyo id existe pero en OTRO negocio cuenta como huérfano', () => {
    expect(clasificarPdf(`${A}/${P2}.pdf`, docs)).toBe('huerfano');
  });
  it('PDF sin fila = huérfano; carpeta sin documentos = huérfano', () => {
    expect(clasificarPdf(`${A}/0ecdbd0f-0000-4000-8000-000000000000.pdf`, docs)).toBe('huerfano');
    expect(clasificarPdf(`33333333-0000-4000-8000-000000000001/${P1}.pdf`, docs)).toBe('huerfano');
  });
  it('ruta rara = no reconocido', () => {
    expect(clasificarPdf(`${A}/notas.txt`, docs)).toBe('no_reconocido');
    expect(clasificarPdf(`${P1}.pdf`, docs)).toBe('no_reconocido');
  });
  it('solo sobrante y huérfano se pueden borrar', () => {
    expect(['ok', 'vigente', 'no_reconocido'].some(esBorrable)).toBe(false);
    expect(esBorrable('sobrante') && esBorrable('huerfano')).toBe(true);
  });
});

describe('borrarEnLotes', () => {
  const rutas = Array.from({ length: 250 }, (_, i) => `x/${i}.pdf`);
  it('sin --borrar no llama nunca a remove', async () => {
    const remove = jest.fn();
    const r = await borrarEnLotes({ from: () => ({ remove }) }, 'b', rutas, { borrar: false });
    expect(remove).not.toHaveBeenCalled();
    expect(r).toEqual({ borrados: 0, fallidos: 0 });
  });
  it('con --borrar borra en lotes de 100 y cuenta los fallos', async () => {
    const remove = jest.fn().mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'x' } }).mockResolvedValueOnce({ error: null });
    const r = await borrarEnLotes({ from: () => ({ remove }) }, 'b', rutas, { borrar: true, lote: 100 });
    expect(remove.mock.calls.map((c) => c[0].length)).toEqual([100, 100, 50]);
    expect(r).toEqual({ borrados: 150, fallidos: 100 });
  });
});
