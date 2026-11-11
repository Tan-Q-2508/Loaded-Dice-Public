/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0f0c0a',
          900: '#171310',
          800: '#241c16',
          700: '#3a2e24',
          600: '#4d3d30',
        },
        brass: {
          300: '#e2c078',
          400: '#d4a84b',
          500: '#c4922e',
          600: '#a67922',
          700: '#7a5818',
        },
        clay: {
          400: '#a84a38',
          500: '#8b3a2a',
          600: '#6e2e22',
          700: '#4a1f18',
        },
        mist: {
          100: '#f2ebe3',
          200: '#e4d8c8',
          300: '#c9b79e',
          400: '#a8947a',
        },
        parchment: {
          100: '#f3e6d0',
          200: '#e8d4b0',
          300: '#d4b88a',
        },
        dharma: {
          400: '#d4a84b',
          500: '#c4922e',
          600: '#8a6a1c',
        },
        adharma: {
          400: '#c45a48',
          500: '#9e3a2c',
          600: '#6e2e22',
        },
        ash: {
          400: '#8a8074',
          500: '#5c544c',
          600: '#3a342e',
        },
      },
      fontFamily: {
        display: ['"Fraunces"', 'Georgia', 'serif'],
        body: ['"Figtree"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 40px rgba(196, 146, 46, 0.12)',
        table: 'inset 0 1px 0 rgba(226, 192, 120, 0.08), 0 24px 48px rgba(0, 0, 0, 0.45)',
        seat: '0 8px 24px rgba(0, 0, 0, 0.35)',
      },
      keyframes: {
        revealCurtain: {
          '0%': { opacity: '0', transform: 'scale(1.02)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        seatPulse: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(196, 146, 46, 0.35)' },
          '50%': { boxShadow: '0 0 0 6px rgba(196, 146, 46, 0)' },
        },
      },
      animation: {
        revealCurtain: 'revealCurtain 520ms ease-out',
        seatPulse: 'seatPulse 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
