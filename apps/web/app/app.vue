<template>
  <div :data-theme="theme" style="height: 100%">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <Toast position="top-right" />
    <ConfirmDialog />
  </div>
</template>

<script setup lang="ts">
const theme = useCookie('theme', { default: () => 'light' })
provide('theme', theme)

// Mirror data-theme onto <html> so PrimeVue's CSS variables (scoped to
// [data-theme="dark"]) and our chat tokens both pick it up regardless of
// selector specificity.
useHead({
  htmlAttrs: computed(() => ({ 'data-theme': theme.value })),
})
</script>
