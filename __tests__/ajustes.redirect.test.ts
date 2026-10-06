const mockRedirect = jest.fn();
jest.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => mockRedirect(...a) }));

it('/ajustes redirige a /ajustes/marca (antes daba 404)', async () => {
  const { default: Page } = await import('@/app/ajustes/page');
  Page();
  expect(mockRedirect).toHaveBeenCalledWith('/ajustes/marca');
});
