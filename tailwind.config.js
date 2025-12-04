/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'serviceit-navy': '#002b5c',
        'serviceit-orange': '#ff9900',
      },
    },
  },
  plugins: [],
  // Prefix to avoid conflicts with host site
  prefix: 'sit-',
  important: '#serviceit-assistant-root',
}


