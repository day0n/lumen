import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,html}'],
  darkMode: ['class', '[data-mantine-color-scheme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Lumen brand — 冷蓝 + 流明金 + 深色基调
        ink: {
          50: '#f4f6f8',
          100: '#e2e7ec',
          200: '#c6ced6',
          300: '#9ba6af',
          400: '#68737d',
          500: '#3c434a',
          600: '#292e33',
          700: '#1b1f23',
          800: '#111315',
          900: '#090a0b',
          950: '#050607',
        },
        flame: {
          50: '#edfbff',
          100: '#d4f6ff',
          200: '#a4edff',
          300: '#79e4ff',
          400: '#4fd4f4',
          500: '#27bde3',
          600: '#1397bd',
          700: '#107797',
          800: '#145f78',
          900: '#164f65',
        },
        glow: {
          50: '#fff9ec',
          100: '#fff1ca',
          200: '#ffdf90',
          300: '#ffc756',
          400: '#ffb02a',
          500: '#fc9213',
          600: '#df6c0a',
          700: '#b94c0c',
          800: '#963c11',
          900: '#7b3211',
        },
      },
      fontFamily: {
        sans: [
          'var(--font-inter)',
          '-apple-system',
          'BlinkMacSystemFont',
          'PingFang SC',
          'Helvetica Neue',
          'sans-serif',
        ],
        display: [
          'var(--font-display)',
          '-apple-system',
          'BlinkMacSystemFont',
          'PingFang SC',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      backdropBlur: {
        xs: '2px',
      },
      backgroundImage: {
        'flame-gradient': 'linear-gradient(135deg, #ff4d2e 0%, #ff7a4a 35%, #ffb02a 100%)',
        aurora:
          'radial-gradient(ellipse at 20% 0%, rgba(255,77,46,0.20), transparent 50%), radial-gradient(ellipse at 80% 30%, rgba(255,176,42,0.14), transparent 45%), radial-gradient(ellipse at 50% 100%, rgba(124,58,237,0.10), transparent 50%)',
      },
      boxShadow: {
        'glass-sm': '0 1px 2px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
        'glass-md':
          '0 8px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.3)',
        'glass-lg':
          '0 24px 48px -12px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.07)',
        'flame-glow': '0 8px 32px -8px rgba(255,77,46,0.55)',
      },
      keyframes: {
        'aurora-shift': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          '50%': { transform: 'translate3d(2%, -2%, 0) scale(1.04)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'float-y': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'spin-slow': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'aurora-shift': 'aurora-shift 20s ease-in-out infinite',
        shimmer: 'shimmer 6s linear infinite',
        'float-y': 'float-y 5s ease-in-out infinite',
        'spin-slow': 'spin-slow 3.6s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
