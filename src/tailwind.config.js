/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
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
        'glow-accent': '0 0 20px #2563a020, 0 0 40px #2563a010',
        'glow-success': '0 0 12px #3d8c4020',
        'inner-light': 'inset 0 1px 0 0 rgba(255,255,255,0.03)',
        'card': '0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.3)',
      },
      animation: {
        'pulse-dot': 'pulseDot 2s ease-in-out infinite',
        'fade-in': 'fadeIn 0.25s ease-out',
        'slide-up': 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-down': 'slideDown 0.2s ease-out',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        pulseDot: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.5', transform: 'scale(0.85)' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
};
