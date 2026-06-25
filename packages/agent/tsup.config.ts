import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/openclaw.ts', 'src/hermes.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  sourcemap: true,
});
