import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/benchmark/performance/**/*.bench.ts'],
    environment: 'node',
    testTimeout: 40_000,
    hookTimeout: 10_000,
  },
})
