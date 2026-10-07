import { enriquecerTextoConMaps } from '@/lib/maps';

describe('enriquecerTextoConMaps no toca las URLs', () => {
  it('una URL firmada con una calle dentro no se rompe', () => {
    const url = 'https://xyz.supabase.co/storage/v1/object/sign/presupuestos-pdf/Calle%20Mayor%203/abc.pdf?token=eyJ.abc.def';
    const t = `Aquí tienes el PDF: [Descargar](${url}) (caduca en 7 días).`;
    expect(enriquecerTextoConMaps(t)).toBe(t);
  });
  it('una URL suelta con una dirección en la ruta tampoco', () => {
    const t = 'Enlace: https://ejemplo.test/descargas/Calle Mayor 3/fichero.pdf?x=1';
    const r = enriquecerTextoConMaps(t);
    expect(r).toContain('https://ejemplo.test/descargas/');
    expect(r).not.toMatch(/https:\/\/ejemplo\.test\/descargas\/\[/);
  });
  it('una dirección normal en el texto sí se enlaza', () => {
    expect(enriquecerTextoConMaps('La obra está en Calle Mayor 3, Irún.')).toMatch(/\]\(https:\/\/maps\.google\.com/);
  });
});
