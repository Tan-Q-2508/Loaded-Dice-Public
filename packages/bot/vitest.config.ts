import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@shaatir-shakuni/engine': path.resolve(__dirname, '../engine/src/index.ts'),
      '@shaatir-shakuni/socket-api': path.resolve(__dirname, '../socket-api/src/index.ts'),
      '@shaatir-shakuni/server': path.resolve(__dirname, '../server/src/index.ts'),
      '@shaatir-shakuni/lobby': path.resolve(__dirname, '../lobby/src/index.ts'),
      '@shaatir-shakuni/auth': path.resolve(__dirname, '../auth/src/index.ts'),
      '@shaatir-shakuni/db': path.resolve(__dirname, '../db/src/index.ts'),
      '@shaatir-shakuni/reconnect': path.resolve(__dirname, '../reconnect/src/index.ts'),
      '@shaatir-shakuni/sim': path.resolve(__dirname, '../sim/src/index.ts'),
    },
  },
});
