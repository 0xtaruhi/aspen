import path from 'node:path'
import { env } from 'node:process'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const host = env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('monaco-editor')) {
            return 'monaco'
          }

          if (id.includes('/node_modules/vue/') || id.includes('/node_modules/vue-router/')) {
            return 'vue-vendor'
          }

          if (id.includes('/node_modules/@tauri-apps/')) {
            return 'tauri-vendor'
          }

          if (
            id.includes('/node_modules/reka-ui/') ||
            id.includes('/node_modules/lucide-vue-next/') ||
            id.includes('/node_modules/@tanstack/')
          ) {
            return 'ui-vendor'
          }
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
}))
