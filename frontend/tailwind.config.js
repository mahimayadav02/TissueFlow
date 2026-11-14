/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: { DEFAULT: '#143A30', 700: '#1F5C4A', 600: '#2A6453', 500: '#2F7A63', 100: '#D3EEDD', 50: '#EEF7F1' },
        // Cool "agar white" page and green-grey lines: reads as a lab, not a paper notebook.
        paper: '#F2F5F2',
        line: '#D6DFD9',
        ink: { DEFAULT: '#16211C', muted: '#4D5A54' },
        sage: '#A9C6BA',
        amberx: { 100: '#FCE7CD', 700: '#7C2D12' },
        redx: { 100: '#F7D4CF', 700: '#8A1C12' },
        bluex: { 100: '#DCE6FA', 700: '#1E3A8A' },
        purplex: { 100: '#E9E2F7', 700: '#4C1D95' },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        // One family for the whole app; headings get weight and tight spacing instead of a second typeface.
        display: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        // Only for real codes: tray QR codes, batch and stage codes, media lots.
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { xl: '12px' },
    },
  },
  plugins: [],
};
