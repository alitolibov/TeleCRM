export default defineNuxtConfig({
  compatibilityDate: '2025-05-06',
  devtools: { enabled: true },
  runtimeConfig: {
    public: {
      apiUrl: process.env.NUXT_PUBLIC_API_URL ?? 'http://localhost:3000',
      wsUrl: process.env.NUXT_PUBLIC_WS_URL ?? 'ws://localhost:3000',
    },
  },
})
