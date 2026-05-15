import { definePreset } from '@primevue/themes'
import Aura from '@primevue/themes/aura'

const TeleCRMPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#f5f3ff',
      100: '#ede8ff',
      200: '#ddd6fe',
      300: '#c4b5fd',
      400: '#a78bfa',
      500: '#8b6dff',
      600: '#6d4ef2',
      700: '#5a3de0',
      800: '#4a2fc8',
      900: '#3b21a8',
      950: '#261380',
    },
    colorScheme: {
      light: {
        primary: {
          color: '{primary.600}',
          inverseColor: '#ffffff',
          hoverColor: '{primary.700}',
          activeColor: '{primary.800}',
        },
        surface: {
          0: '#ffffff',
          50: '#faf9fd',
          100: '#f6f5fb',
          200: '#f0eef7',
          300: '#e8e4f0',
          400: '#d8d2e6',
          500: '#9c97ae',
          600: '#6b6584',
          700: '#4a4464',
          800: '#2d2748',
          900: '#1a1530',
          950: '#0d0b1a',
        },
      },
      dark: {
        primary: {
          color: '{primary.500}',
          inverseColor: '{surface.950}',
          hoverColor: '{primary.400}',
          activeColor: '{primary.300}',
        },
        surface: {
          0: '#ffffff',
          50: '#252238',
          100: '#1e1b30',
          200: '#181527',
          300: '#141121',
          400: '#0f0d1a',
          500: '#6b6584',
          600: '#9c97ae',
          700: '#c8c3d8',
          800: '#e8e4f0',
          900: '#f0eef7',
          950: '#f6f5fb',
        },
      },
    },
  },
})

export default defineNuxtConfig({
  compatibilityDate: '2025-05-06',
  ssr: false,
  experimental: {
    payloadExtraction: false,
    viteEnvironmentApi: true,
  },
  modules: [
    '@pinia/nuxt',
    '@nuxtjs/tailwindcss',
    '@primevue/nuxt-module',
  ],
  primevue: {
    autoImport: true,
    options: {
      theme: {
        preset: TeleCRMPreset,
        options: {
          darkModeSelector: '[data-theme="dark"]',
          cssLayer: { name: 'primevue', order: 'tailwind-base, primevue, tailwind-utilities' },
        },
      },
    },
  },
  css: ['~/assets/css/main.css', 'primeicons/primeicons.css'],
  app: {
    head: {
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap',
        },
      ],
    },
  },
  runtimeConfig: {
    public: {
      apiUrl: process.env.NUXT_PUBLIC_API_URL ?? 'http://localhost:3000',
      wsUrl: process.env.NUXT_PUBLIC_WS_URL ?? 'http://localhost:3000',
    },
  },
})
