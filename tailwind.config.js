/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0b0f14',
          card: '#121821',
          hover: '#1a2230',
          border: '#1f2a37'
        },
        accent: {
          green: '#22c55e',
          'green-soft': '#16a34a',
          red: '#ef4444',
          'red-soft': '#dc2626',
          yellow: '#eab308',
          blue: '#3b82f6'
        },
        text: {
          primary: '#e5e7eb',
          secondary: '#9ca3af',
          muted: '#6b7280'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
};
