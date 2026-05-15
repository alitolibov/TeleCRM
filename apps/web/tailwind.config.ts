import type { Config } from 'tailwindcss'
import primeui from 'tailwindcss-primeui'

export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./app/**/*.{vue,ts,tsx}'],
  plugins: [primeui],
} satisfies Config
