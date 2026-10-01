import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'src/client/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  outDir: 'lib',
  fixedExtension: false,
  deps: { neverBundle: [/^@deepseek-ai\//, 'react'] },
})
