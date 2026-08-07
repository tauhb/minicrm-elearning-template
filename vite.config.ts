import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  server: {
    port: 5009,
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:3001',
      '/f': {
        target: 'http://localhost:3001',
        rewrite: (path) => {
          // /f/khoa-ai-marketing → /api/f/render?slug=khoa-ai-marketing
          const m = path.match(/^\/f\/([^/?]+)/)
          if (!m) return path
          return `/api/f/render?slug=${encodeURIComponent(m[1])}`
        },
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split vendor libraries để cache tốt hơn + main bundle nhỏ hơn
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase':     ['@supabase/supabase-js'],
          'date-fns':     ['date-fns'],
          'icons':        ['lucide-react'],
        },
      },
    },
  },
})
