const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/**
 * Self-checks for pure logic only — no DOM, no component rendering. The point
 * is one runnable thing that fails if the graph builders break, not a suite.
 */
module.exports = createJestConfig({
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
});
