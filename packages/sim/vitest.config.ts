import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      '@shaatir-shakuni/engine': path.resolve(
        __dirname,
        '../engine/src/index.ts',
      ),
    },
  },
});
