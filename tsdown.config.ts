import { defineConfig } from 'tsdown'

/**
 * Client modules are loaded by the DSH web client through
 * `window.__ModuleLoader__.load({ id, factory: (require) => ... })`, and the
 * module ids inside `require` are the sibling client *package* ids declared in
 * `dsh.client.inject` (see the official `dsh-client-ui-*` bundles). A plain ESM
 * client bundle with bare imports cannot be resolved by that loader: the
 * plugin's UI half would fail to load at runtime even though host-side
 * typecheck/tests pass. Keep this list in sync with `src/client/index.ts`.
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-settings',
]

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: false,
    clean: false,
    outDir: 'lib',
    fixedExtension: false,
    deps: { neverBundle: [/^@deepseek-ai\//, 'react'] },
  },
  {
    entry: { client: 'src/client/index.ts' },
    format: 'cjs',
    platform: 'browser',
    dts: true,
    sourcemap: false,
    clean: false,
    outDir: 'lib',
    fixedExtension: false,
    define: {
      'process.env.NODE_ENV': JSON.stringify(
        process.env.NODE_ENV ?? 'production',
      ),
    },
    deps: {
      neverBundle: CLIENT_EXTERNALS,
      alwaysBundle: (id: string) => !CLIENT_EXTERNALS.includes(id),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner:
        'window.__ModuleLoader__.load({ id: "dsh-computer-history", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      codeSplitting: false,
    },
  },
  {
    // Declarations for `exports["./client"].types`. The wrapped CJS client
    // bundle above cannot emit them itself, so they come from a plain ESM pass
    // whose JavaScript stub is deleted by the build script.
    entry: { client: 'src/client/index.ts' },
    format: 'esm',
    platform: 'browser',
    dts: true,
    sourcemap: false,
    clean: false,
    outDir: 'lib/.client-dts',
    fixedExtension: false,
    deps: {
      neverBundle: CLIENT_EXTERNALS,
      alwaysBundle: (id: string) => !CLIENT_EXTERNALS.includes(id),
    },
  },
])
