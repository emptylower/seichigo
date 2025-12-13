import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    setupFiles: ['tests/setup.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          include: ['tests/**/*.test.tsx'],
          environment: 'jsdom',
        },
      },
    ],
  },
})
