/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        r: {
          950: '#0d0d0d',
          900: '#141414',
          850: '#1a1a1a',
          800: '#1e1e1e',
          750: '#222222',
          700: '#2a2a2a',
          650: '#303030',
          600: '#383838',
          500: '#444444',
          400: '#666666',
          300: '#888888',
          200: '#aaaaaa',
          100: '#cccccc',
          50: '#e0e0e0',
        },
        accent: {
          DEFAULT: '#2563a0',
          hover: '#2d75b8',
          glow: '#2563a040',
          subtle: '#2563a015',
        },
        success: { DEFAULT: '#3d8c40', glow: '#3d8c4030' },
        warn: { DEFAULT: '#c67d1a', glow: '#c67d1a30' },
        danger: { DEFAULT: '#c0392b', glow: '#c0392b30' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      boxShadow: {
        'glow-accent': '0 2px 8px #2563a030, inset 0 1px 0 rgba(255,255,255,0.1)',
        'card': '0 1px 2px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.02)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.02)',
        'inner-light': 'inset 0 1px 0 rgba(255,255,255,0.02)',
      },
      animation: {
        'pulse-dot': 'pulseDot 2s ease-in-out infinite',
        'fade-in': 'fadeIn 0.25s ease-out',
        'fade-up': 'fadeUp 0.8s ease forwards',
      },
      keyframes: {
        pulseDot: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.4', transform: 'scale(0.85)' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(30px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
