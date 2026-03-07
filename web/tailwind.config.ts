import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Semantic theme tokens (CSS variable-driven)
        surface: 'var(--color-surface)',
        page: 'var(--color-page)',
        panel: 'var(--color-panel)',
        card: {
          DEFAULT: 'var(--color-card)',
          hover: 'var(--color-card-hover)',
        },
        sidebar: {
          bg: 'var(--color-sidebar-bg)',
          text: 'var(--color-sidebar-text)',
          muted: 'var(--color-sidebar-muted)',
          active: 'var(--color-sidebar-active)',
          hover: 'var(--color-sidebar-hover)',
          border: 'var(--color-sidebar-border)',
        },
        // Gito brand — electric blue
        primary: {
          50:  '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        accent: {
          50:  '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          700: '#0e7490',
          800: '#155e75',
          900: '#164e63',
        },
        gito: {
          dark: '#001F3F',
          light: '#E8F4F8',
        },
        hmi: {
          surface: '#f4f7fb',
          panel: '#eef2f8',
          inset: '#d4dff0',
          border: '#c8d6ec',
          value: '#0d1422',
          muted: '#7c9bc2',
        },
      },
      textColor: {
        'th-primary': 'var(--color-text-primary)',
        'th-secondary': 'var(--color-text-secondary)',
        'th-muted': 'var(--color-text-muted)',
      },
      borderColor: {
        'th-default': 'var(--color-border)',
        'th-subtle': 'var(--color-border-subtle)',
      },
      fontFamily: {
        sans: [
          'Plus Jakarta Sans',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'ui-monospace',
          'monospace',
        ],
      },
      boxShadow: {
        'glow-sm': '0 0 12px rgba(37, 99, 235, 0.15)',
        'glow':    '0 0 24px rgba(37, 99, 235, 0.2)',
        'glow-lg': '0 0 40px rgba(37, 99, 235, 0.25)',
      },
      keyframes: {
        'fade-in': {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%':   { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',   opacity: '1' },
        },
        'slide-in-right': {
          '0%':   { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)',    opacity: '1' },
        },
      },
      animation: {
        'fade-in':       'fade-in 0.2s ease-out',
        'slide-up':      'slide-up 0.25s ease-out',
        'slide-in-right':'slide-in-right 0.3s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;