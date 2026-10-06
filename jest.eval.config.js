// Configuración de Jest solo para `npm run eval:agente` (contra el modelo REAL).
// Igual que jest.config.js, pero buscando los *.eval.ts de la carpeta evals/ en vez de los tests.
const customJestConfig = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/evals/**/*.eval.ts'],
  testTimeout: 120000,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};

module.exports = async () => {
  const { default: nextJest } = await import('next/jest.js');
  const createJestConfig = nextJest({
    dir: './',
  });

  return createJestConfig(customJestConfig)();
};
