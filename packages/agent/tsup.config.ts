import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  entry: ['src/index.ts', 'src/openclaw.ts', 'src/hermes.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  sourcemap: true,
  // VERSION export is stamped from package.json at build time so it can never
  // drift from the published version.
  define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
});
