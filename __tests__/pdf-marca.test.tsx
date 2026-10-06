// @react-pdf/renderer es solo ESM y Jest no lo carga; aquí solo hacen falta los estilos (StyleSheet.create es la identidad).
jest.mock('@react-pdf/renderer', () => ({
  Document: 'Document',
  Image: 'Image',
  Page: 'Page',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s },
  renderToBuffer: jest.fn(),
}));

import {
  DEFECTO_FACTURA,
  DEFECTO_PRESUPUESTO,
  MARCA_VACIA,
  OBSERVACIONES_PRESUPUESTO_DEFECTO,
  marcaDesdePerfil,
  validarMarcaEntrada,
} from '@/lib/pdf/marca';
import { crearEstilosPresupuesto } from '@/lib/pdf/presupuesto';
import { crearEstilosFactura } from '@/lib/pdf/factura';
import { LOGO_MAX_BYTES, detectarFormatoLogo, validarAjustesNegocio } from '@/lib/negocio/ajustes';

describe('marcaDesdePerfil', () => {
  it('fila vacía o null → marca vacía (el aspecto de siempre)', () => {
    expect(marcaDesdePerfil(null)).toEqual(MARCA_VACIA);
    expect(marcaDesdePerfil({})).toEqual(MARCA_VACIA);
    expect(
      marcaDesdePerfil({
        marca_color_primario: null,
        marca_color_secundario: null,
        marca_tipografia: null,
        marca_observaciones_presupuesto: null,
      })
    ).toEqual(MARCA_VACIA);
  });
  it('lee valores válidos', () => {
    expect(
      marcaDesdePerfil({
        marca_color_primario: '#7A7A1E',
        marca_color_secundario: '#f3f3dc',
        marca_tipografia: 'Courier',
        marca_observaciones_presupuesto: '  Oferta válida 30 días  ',
      })
    ).toEqual({
      colorPrimario: '#7A7A1E',
      colorSecundario: '#f3f3dc',
      tipografia: 'Courier',
      observacionesPresupuesto: 'Oferta válida 30 días',
    });
  });
  it.each(['red', '#fff', '#12345', '#GGGGGG', '7A7A1E', '#7A7A1E00', ' #7A7A1E'])(
    'hex inválido %p → se ignora',
    (hex) => {
      expect(marcaDesdePerfil({ marca_color_primario: hex, marca_color_secundario: hex }).colorPrimario).toBeNull();
      expect(marcaDesdePerfil({ marca_color_primario: hex, marca_color_secundario: hex }).colorSecundario).toBeNull();
    }
  );
  it.each(['Arial', 'helvetica', 'Comic Sans MS', ''])('tipografía no permitida %p → se ignora', (t) => {
    expect(marcaDesdePerfil({ marca_tipografia: t }).tipografia).toBeNull();
  });
  it('observaciones en blanco → null y se recortan a 1000 caracteres', () => {
    expect(marcaDesdePerfil({ marca_observaciones_presupuesto: '   ' }).observacionesPresupuesto).toBeNull();
    expect(marcaDesdePerfil({ marca_observaciones_presupuesto: 'a'.repeat(5000) }).observacionesPresupuesto).toHaveLength(1000);
  });
});

describe('estilos: con marca vacía salen los de siempre', () => {
  it('presupuesto', () => {
    const s = crearEstilosPresupuesto(MARCA_VACIA);
    expect(s.tableHeader.backgroundColor).toBe('#1e3a8a');
    expect(DEFECTO_PRESUPUESTO.primario).toBe('#1e3a8a');
    expect(s.page.fontFamily).toBe('Helvetica');
    expect(s.capTitulo.color).toBe('#111');
    // Sin fondos añadidos: cajas y filas alternas quedan como antes (sin color).
    expect(s.empresaBox).not.toHaveProperty('backgroundColor');
    expect(s.pieTotales).not.toHaveProperty('backgroundColor');
    expect(s.rowPartidaAlt).toEqual({});
  });
  it('factura', () => {
    const s = crearEstilosFactura(MARCA_VACIA);
    expect(s.thLineas.backgroundColor).toBe('#1a365d');
    expect(s.totalesTh.backgroundColor).toBe('#1a365d');
    expect(s.s1Titulo.color).toBe('#1a365d');
    expect(s.cajaGris.backgroundColor).toBe('#f5f5f5');
    expect(s.cajaGrisCliente.backgroundColor).toBe('#f5f5f5');
    expect(s.rowLineaAlt.backgroundColor).toBe('#fafafa');
    expect(s.page.fontFamily).toBe('Helvetica');
    expect(DEFECTO_FACTURA.primario).toBe('#1a365d');
  });
});

describe('estilos: con marca cambian solo los campos rellenados', () => {
  const marca = { ...MARCA_VACIA, colorPrimario: '#7A7A1E', colorSecundario: '#F3F3DC', tipografia: 'Times-Roman' as const };
  it('presupuesto', () => {
    const s = crearEstilosPresupuesto(marca);
    expect(s.tableHeader.backgroundColor).toBe('#7A7A1E');
    expect(s.capTitulo.color).toBe('#7A7A1E');
    expect(s.page.fontFamily).toBe('Times-Roman');
    expect(s.empresaBox.backgroundColor).toBe('#F3F3DC');
    expect(s.pieTotales.backgroundColor).toBe('#F3F3DC');
    expect(s.rowPartidaAlt).toEqual({ backgroundColor: '#F3F3DC' });
    // El texto libre en formato monoespaciado sigue siendo Courier pase lo que pase.
    expect(s.fallback.fontFamily).toBe('Courier');
  });
  it('solo color primario: no aparecen fondos', () => {
    const s = crearEstilosPresupuesto({ ...MARCA_VACIA, colorPrimario: '#112233' });
    expect(s.tableHeader.backgroundColor).toBe('#112233');
    expect(s.pieTotales).not.toHaveProperty('backgroundColor');
  });
  it('factura', () => {
    const s = crearEstilosFactura(marca);
    expect(s.thLineas.backgroundColor).toBe('#7A7A1E');
    expect(s.s1Titulo.color).toBe('#7A7A1E');
    expect(s.cajaGris.backgroundColor).toBe('#F3F3DC');
    expect(s.rowLineaAlt.backgroundColor).toBe('#F3F3DC');
    expect(s.page.fontFamily).toBe('Times-Roman');
  });
});

describe('validarMarcaEntrada / validarAjustesNegocio', () => {
  it('acepta valores válidos y vacíos como «quitar»', () => {
    expect(
      validarMarcaEntrada({
        marca_color_primario: '#AABBCC',
        marca_color_secundario: '',
        marca_tipografia: 'Courier',
        marca_observaciones_presupuesto: '  hola ',
      })
    ).toEqual({
      ok: true,
      valores: {
        marca_color_primario: '#AABBCC',
        marca_color_secundario: null,
        marca_tipografia: 'Courier',
        marca_observaciones_presupuesto: 'hola',
      },
    });
  });
  it.each([
    [{ marca_color_primario: 'azul' }, /color primario/],
    [{ marca_color_secundario: '#12' }, /color secundario/],
    [{ marca_tipografia: 'Arial' }, /tipografía/],
    [{ marca_observaciones_presupuesto: 'x'.repeat(1001) }, /1000/],
    [{ marca_observaciones_presupuesto: 5 }, /texto/],
  ])('rechaza %j', (entrada, msg) => {
    const r = validarMarcaEntrada(entrada);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(msg);
  });
  it('solo devuelve los campos presentes', () => {
    expect(validarMarcaEntrada({ marca_tipografia: 'Courier' })).toEqual({
      ok: true,
      valores: { marca_tipografia: 'Courier' },
    });
  });
  it('lista blanca: id, business_id, user_id y logo_url del cuerpo se ignoran', () => {
    const r = validarAjustesNegocio({
      id: 'otro',
      business_id: 'otro',
      user_id: 'otro',
      logo_url: '../../etc/passwd',
      nombre: 'hack',
      nif: ' B123 ',
      marca_color_primario: '#000000',
    });
    expect(r).toEqual({ ok: true, valores: { nif: 'B123', marca_color_primario: '#000000' } });
  });
  it('datos fiscales: recorta, vacío = null, iban admite varias líneas, límites', () => {
    expect(validarAjustesNegocio({ razon_social: '  ', iban: 'ES1\r\nES2 ' })).toEqual({
      ok: true,
      valores: { razon_social: null, iban: 'ES1\nES2' },
    });
    expect(validarAjustesNegocio({ nif: 'x'.repeat(301) }).ok).toBe(false);
    expect(validarAjustesNegocio({ nif: 3 }).ok).toBe(false);
    expect(validarAjustesNegocio('texto').ok).toBe(false);
    expect(validarAjustesNegocio([]).ok).toBe(false);
  });
  it('la marca inválida dentro de ajustes también se rechaza', () => {
    expect(validarAjustesNegocio({ marca_color_primario: 'rojo' }).ok).toBe(false);
  });
});

describe('detectarFormatoLogo', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0]);
  const webp = Uint8Array.from([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')]);
  it('reconoce png, jpeg y webp por su contenido', () => {
    expect(detectarFormatoLogo(png)).toEqual({ ext: 'png', mime: 'image/png' });
    expect(detectarFormatoLogo(jpg)).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
    expect(detectarFormatoLogo(webp)).toEqual({ ext: 'webp', mime: 'image/webp' });
  });
  it('rechaza svg, gif, html disfrazado y vacío', () => {
    expect(detectarFormatoLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectarFormatoLogo(Buffer.from('GIF89a....'))).toBeNull();
    expect(detectarFormatoLogo(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(detectarFormatoLogo(new Uint8Array())).toBeNull();
  });
  it('el máximo son 2 MB', () => expect(LOGO_MAX_BYTES).toBe(2 * 1024 * 1024));
});

it('el texto de observaciones por defecto conserva su redacción de siempre', () => {
  expect(OBSERVACIONES_PRESUPUESTO_DEFECTO).toMatch(/^La presente oferta sólo incluye los trabajos/);
  expect(OBSERVACIONES_PRESUPUESTO_DEFECTO).toMatch(/30€\/hora más el material empleado\.$/);
});
