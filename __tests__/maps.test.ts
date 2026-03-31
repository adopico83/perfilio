import { enriquecerTextoConMaps } from '@/lib/maps';

describe('lib/maps', () => {
  it('enriquecerTextoConMaps detecta y enlaza una dirección correctamente', () => {
    const input = 'La obra está en Calle Mayor 15.';
    const out = enriquecerTextoConMaps(input);
    expect(out).toContain('https://maps.google.com/?q=');
    expect(out).toMatch(/\[Calle Mayor 15\]\(https:\/\/maps\.google\.com\/\?q=/);
  });
});
