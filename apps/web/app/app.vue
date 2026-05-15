<template>
  <div :data-theme="theme" style="height: 100%">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <Toast position="top-right" />
  </div>
</template>

<script setup lang="ts">
const theme = useCookie('theme', { default: () => 'light' })
provide('theme', theme)
</script>
