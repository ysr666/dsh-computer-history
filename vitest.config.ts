import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The editor companion is a separate package with its own module system and
    // its own tsconfig; its tests run here (vitest transpiles them) so the root
    // project never has to type-check a file that belongs to that package.
    include: ['tests/**/*.spec.ts', 'extension-editor/tests/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
})
