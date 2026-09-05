const customJestConfig = {
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/helpers/'],
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

