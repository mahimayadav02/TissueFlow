/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: { DEFAULT: '#143A30', 700: '#1F5C4A', 600: '#2A6453', 500: '#2F7A63', 100: '#D3EEDD', 50: '#EEF7F1' },
        paper: '#F4F2EC',
        line: '#DCD6C8',
        ink: { DEFAULT: '#1C2321', muted: '#4F5754' },
        sage: '#A9C6BA',
        amberx: { 100: '#FCE7CD', 700: '#7C2D12' },
        redx: { 100: '#F7D4CF', 700: '#8A1C12' },
        bluex: { 100: '#DCE6FA', 700: '#1E3A8A' },
        purplex: { 100: '#E9E2F7', 700: '#4C1D95' },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      borderRadius: { xl: '12px' },
    },
  },
  plugins: [],
};
