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
          50: '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          700: '#3f3f46',
          800: '#27272a',
          900: '#18181b',
          950: '#09090b',
        },
        text: {
          color: '#18181b',
          hoverColor: '#09090b',
          mutedColor: '#71717a',
          hoverMutedColor: '#52525b',
        },
        content: { background: '#ffffff', hoverBackground: '#f4f4f5', borderColor: '#e4e4e7', color: '#18181b', hoverColor: '#09090b' },
        formField: {
          background: '#ffffff',
          disabledBackground: '#f4f4f5',
          filledBackground: '#f4f4f5',
          filledHoverBackground: '#e4e4e7',
          filledFocusBackground: '#ffffff',
          borderColor: '#d4d4d8',
          hoverBorderColor: '#a1a1aa',
          focusBorderColor: '{primary.color}',
          invalidBorderColor: '{red.400}',
          color: '#18181b',
          disabledColor: '#a1a1aa',
          placeholderColor: '#a1a1aa',
        },
        overlay: {
          select:  { background: '#ffffff', borderColor: '#e4e4e7', color: '#18181b' },
          popover: { background: '#ffffff', borderColor: '#e4e4e7', color: '#18181b' },
          modal:   { background: '#ffffff', borderColor: '#e4e4e7', color: '#18181b' },
        },
      },
      dark: {
        primary: {
          color: '{primary.400}',
          inverseColor: '#0c0a14',
          hoverColor: '{primary.300}',
          activeColor: '{primary.200}',
        },
        // Inverted dark surface so bg-surface-0 = dark and text-surface-900 = light.
        surface: {
          0: '#0c0a14',
          50: '#161324',
          100: '#1e1b2e',
          200: '#27243a',
          300: '#322f48',
          400: '#4a4664',
          500: '#6b6584',
          600: '#9c97ae',
          700: '#c8c3d8',
          800: '#e8e4f0',
          900: '#f4f4f5',
          950: '#fafafa',
        },
        text: {
          color: '#f4f4f5',
          hoverColor: '#fafafa',
          mutedColor: '#9c97ae',
          hoverMutedColor: '#c8c3d8',
        },
        content: { background: '#161324', hoverBackground: '#1e1b2e', borderColor: '#27243a', color: '#f4f4f5', hoverColor: '#fafafa' },
        // Aura's defaults reference surface-950 / surface-800 for form bg, which are
        // LIGHT in our inverted dark scale. Hardcode the proper dark values.
        formField: {
          background: '#1e1b2e',
          disabledBackground: '#27243a',
          filledBackground: '#27243a',
          filledHoverBackground: '#322f48',
          filledFocusBackground: '#27243a',
          borderColor: '#322f48',
          hoverBorderColor: '#4a4664',
          focusBorderColor: '{primary.color}',
          invalidBorderColor: '{red.400}',
          color: '#f4f4f5',
          disabledColor: '#6b6584',
          placeholderColor: '#6b6584',
        },
        // Aura references surface-900 (= LIGHT in our inverted scale) for overlay
        // bg, which renders dialogs/popovers white in dark mode. Hardcode dark values.
        overlay: {
          select:  { background: '#1e1b2e', borderColor: '#322f48', color: '#f4f4f5' },
          popover: { background: '#1e1b2e', borderColor: '#322f48', color: '#f4f4f5' },
          modal:   { background: '#1e1b2e', borderColor: '#322f48', color: '#f4f4f5' },
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
      locale: {
        firstDayOfWeek: 1,
        dayNames: ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'],
        dayNamesShort: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
        dayNamesMin: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
        monthNames: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
        monthNamesShort: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'],
        today: 'Сегодня',
        clear: 'Очистить',
        weekHeader: 'Нед',
        chooseYear: 'Выберите год',
        chooseMonth: 'Выберите месяц',
        chooseDate: 'Выберите дату',
        prevMonth: 'Прошлый месяц',
        nextMonth: 'Следующий месяц',
        fileSizeTypes: ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ', 'ЭБ', 'ЗБ', 'ЙБ'],
      } as any,
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
