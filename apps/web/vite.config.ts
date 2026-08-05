import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(rootDir, 'src')

// Local dev: proxy API + WS to team-lite backend (D1 default port).
// See docs/local-dev.md
const backend = process.env.VITE_BACKEND_ORIGIN ?? 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Longer prefixes first — @renderer/pages lives under src/pages
      { find: '@renderer/pages', replacement: path.resolve(srcDir, 'pages') },
      { find: '@renderer/hooks', replacement: path.resolve(srcDir, 'renderer/hooks') },
      { find: '@renderer/components', replacement: path.resolve(srcDir, 'renderer/components') },
      { find: '@renderer/utils', replacement: path.resolve(srcDir, 'renderer/utils') },
      { find: '@renderer/styles', replacement: path.resolve(srcDir, 'renderer/styles') },
      { find: '@renderer/services', replacement: path.resolve(srcDir, 'renderer/services') },
      { find: '@/renderer/pages', replacement: path.resolve(srcDir, 'pages') },
      { find: '@/renderer/hooks', replacement: path.resolve(srcDir, 'renderer/hooks') },
      { find: '@/renderer/components', replacement: path.resolve(srcDir, 'renderer/components') },
      { find: '@/renderer/utils', replacement: path.resolve(srcDir, 'renderer/utils') },
      { find: '@/renderer/styles', replacement: path.resolve(srcDir, 'renderer/styles') },
      { find: '@/renderer/services', replacement: path.resolve(srcDir, 'renderer/services') },
      { find: '@', replacement: srcDir },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: backend,
        changeOrigin: true,
      },
      '/ws': {
        target: backend,
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
