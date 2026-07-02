import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/index.ts',
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        // El render WASM (pdfium) y la decodificación PDF417 (zxing-wasm) son
        // adapters de I/O sobre binarios WASM: no se unit-testean sin un PDF
        // real con timbre (fuera del alcance del CI sin fixtures binarios).
        // La lógica pura (parser <DD>, retención, detección de tipo, mapeo) sí
        // se cubre. El orquestador `pdf-ted-ingestor` se cubre con dobles de
        // los adapters; los adapters concretos quedan excluidos.
        'src/raster/pdfium-renderer.ts',
        'src/barcode/zxing-pdf417.ts',
        'src/preprocess/sharp-photo.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
