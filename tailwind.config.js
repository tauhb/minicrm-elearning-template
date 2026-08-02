/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './App.tsx',
    './index.tsx',
    './components/**/*.{ts,tsx}',
    './contexts/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        mission: {
          bg:      'var(--theme-bg, #050505)',
          card:    'var(--theme-surface, #0a0a0a)',
          accent:  '#B6FF00',
          success: '#B6FF00',
          warning: '#f59e0b',
          locked:  '#262626',
        },
      },
      animation: {
        'radar':         'radar 2s linear infinite',
        'scan':          'scan 4s linear infinite',
        'glitch':        'glitch 1s linear infinite',
        'flicker':       'flicker 3s infinite alternate',
        'flicker-fast':  'flicker 1.5s infinite alternate',
        'bounce-gentle': 'bounce-gentle 2s ease-in-out infinite',
      },
      keyframes: {
        radar: {
          '0%':   { transform: 'scale(0.8)', opacity: '0.8' },
          '100%': { transform: 'scale(2.5)', opacity: '0' },
        },
        scan: {
          '0%':   { backgroundPosition: '0% 0%' },
          '100%': { backgroundPosition: '0% 100%' },
        },
        flicker: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%':      { opacity: '0.6', transform: 'scale(0.95)' },
        },
        'bounce-gentle': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-3px)' },
        },
      },
    },
  },
  plugins: [],
}
