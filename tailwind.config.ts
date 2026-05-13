import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './features/**/*.{ts,tsx}',
    './content/**/*.{md,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#ec4899', // pink-500
          50: '#fdf2f8',
          100: '#fce7f3',
          200: '#fbcfe8',
          300: '#f9a8d4',
          400: '#f472b6',
          500: '#ec4899',
          600: '#db2777',
          700: '#be185d',
          800: '#9d174d',
          900: '#831843',
        },
        journal: {
          paper: '#f3ecdc',
          'paper-warm': '#ede4cf',
          'paper-card': '#fdfaf3',
          ink: '#1f1a13',
          'ink-soft': '#4a4236',
          'ink-muted': '#847b6c',
          seal: '#a8392b',
          'seal-deep': '#862c20',
          indigo: '#2d3e50',
          thread: 'rgba(31, 26, 19, 0.18)',
        },
      },
      fontFamily: {
        display: ['var(--font-noto-sans-sc)', '"Noto Sans SC"', 'sans-serif'],
        body: ['var(--font-inter)', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        'journal-serif': ['"Noto Serif SC"', '"Songti SC"', 'serif'],
        'journal-latin': ['"Cormorant Garamond"', 'serif'],
        'journal-hand': ['"Ma Shan Zheng"', '"Noto Serif SC"', 'serif'],
      },
    },
  },
  plugins: [],
}

export default config
