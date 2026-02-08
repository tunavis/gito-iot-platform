import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Gito brand colors from logo
        primary: {
          50: '#f0f6ff',
          100: '#e0ecff',
          200: '#c7dcff',
          300: '#a3c4ff',
          400: '#7aa1ff',
          500: '#4f7cff',
          600: '#0066CC', // Gito dark blue
          700: '#0052a3',
          800: '#003d7a',
          900: '#002952',
        },
        accent: {
          50: '#e0f7ff',
          100: '#b3ecff',
          200: '#80dfff',
          300: '#4dd4ff',
          400: '#1ac9ff',
          500: '#00A8E8', // Gito light blue
          600: '#0088c4',
          700: '#0069a0',
          800: '#004a7c',
          900: '#002b4d',
        },
        gito: {
          dark: '#001F3F', // Navy for contrast
          light: '#E8F4F8', // Light blue background
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-in-out',
        'slide-up': 'slide-up 0.3s ease-out',
        'slide-in-right': 'slide-in-right 0.3s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
