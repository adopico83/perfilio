const OpenAIMock = jest.fn().mockImplementation(() => ({}));
jest.mock('openai', () => ({ __esModule: true, default: function (...a: unknown[]) { return OpenAIMock(...a); } }));

it.each([
  ['/api/agente', '@/app/api/agente/route'],
  ['/api/transcribe', '@/app/api/transcribe/route'],
  ['lib/dictado-presupuesto', '@/lib/dictado-presupuesto'],
])('importar %s no crea el cliente de OpenAI (build sin OPENAI_API_KEY)', async (_n, ruta) => {
  await expect(import(ruta)).resolves.toBeDefined();
  expect(OpenAIMock).not.toHaveBeenCalled();
});
