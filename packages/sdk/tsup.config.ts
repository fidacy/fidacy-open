import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  sourcemap: true,
  // VERSION export is stamped from package.json at build time so it can never
  // drift from the published version (it sat hardcoded at "0.0.0" through 0.1.1).
  define: { __SDK_VERSION__: JSON.stringify(pkg.version) },
});
