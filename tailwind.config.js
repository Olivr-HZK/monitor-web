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
        surface: '#F7F7F4',
        surfaceHover: '#EFEFEC',
        panel: '#FFFFFF',
        line: '#DEDED8',
        ink: '#1D1D1B',
        inkLight: '#666660',
        muted: '#8B8B84',
        accent: '#2563EB',
        accentBlue: '#2563EB',
      },
      boxShadow: {
        'brutal': '0 16px 40px -28px rgba(29,29,27,0.55)',
        'brutal-sm': '0 10px 24px -20px rgba(29,29,27,0.45)',
        'brutal-hover': '0 20px 44px -30px rgba(29,29,27,0.55)',
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
