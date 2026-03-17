import path from 'node:path'
import { defineConfig } from 'vitest/config'

const alias = {
  '@': path.resolve(__dirname, './src'),
}

export default defineConfig({
  resolve: {
    alias,
  },
  test: {
    alias,
    passWithNoTests: true,
    projects: [
      {
        resolve: {
          alias,
        },
        test: {
          name: 'navigation',
          alias,
          include: [
            'src/**/navigation/**/*.{test,spec}.{ts,tsx}',
            'src/**/*navigation*.{test,spec}.{ts,tsx}',
          ],
        },
      },
      {
        resolve: {
          alias,
        },
        test: {
          name: 'stores',
          alias,
          include: ['src/stores/**/*.{test,spec}.{ts,tsx}'],
        },
      },
      {
        resolve: {
          alias,
        },
        test: {
          name: 'lib',
          alias,
          include: ['src/lib/**/*.{test,spec}.{ts,tsx}'],
        },
      },
      {
        resolve: {
          alias,
        },
        test: {
          name: 'virtual-device',
          alias,
          include: [
            'src/**/virtual-device/**/*.{test,spec}.{ts,tsx}',
            'src/**/*virtual-device*.{test,spec}.{ts,tsx}',
          ],
        },
      },
    ],
  },
})
