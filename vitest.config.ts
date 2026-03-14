import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'navigation',
          include: [
            'src/**/navigation/**/*.{test,spec}.{ts,tsx}',
            'src/**/*navigation*.{test,spec}.{ts,tsx}',
          ],
        },
      },
      {
        test: {
          name: 'stores',
          include: ['src/stores/**/*.{test,spec}.{ts,tsx}'],
        },
      },
      {
        test: {
          name: 'virtual-device',
          include: [
            'src/**/virtual-device/**/*.{test,spec}.{ts,tsx}',
            'src/**/*virtual-device*.{test,spec}.{ts,tsx}',
          ],
        },
      },
    ],
  },
})
