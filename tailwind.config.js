/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
        display: ['"Outfit"', 'sans-serif'],
      },
      colors: {
        surface: '#F4F4F2',
        surfaceHover: '#EBEBE8',
        ink: '#111110',
        inkLight: '#4A4A46',
        accent: '#FF4500', // vibrant orange
        accentBlue: '#0055FF', // electric blue
      },
      boxShadow: {
        'brutal': '4px 4px 0px 0px rgba(17,17,16,1)',
        'brutal-sm': '2px 2px 0px 0px rgba(17,17,16,1)',
        'brutal-hover': '6px 6px 0px 0px rgba(17,17,16,1)',
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        }
      }
    },
  },
  plugins: [],
}
