const customJestConfig = {
  testEnvironment: 'node',
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

