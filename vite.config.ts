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
          // /f/khoa-ai/pay/<order-id>         → /api/f/pay?order=<order-id>
          // /f/khoa-ai                        → /api/f/render?funnel=khoa-ai
          // /f/khoa-ai/landing                → /api/f/render?funnel=khoa-ai&step=landing
          const payMatch = path.match(/^\/f\/([^/?]+)\/pay\/([^/?]+)/)
          if (payMatch) return `/api/f/pay?order=${encodeURIComponent(payMatch[2])}`
          const m = path.match(/^\/f\/([^/?]+)(?:\/([^/?]+))?/)
          if (!m) return path
          const funnel = encodeURIComponent(m[1])
          const step = m[2] ? `&step=${encodeURIComponent(m[2])}` : ''
          return `/api/f/render?funnel=${funnel}${step}`
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
