<script setup lang="ts">
const config = useRuntimeConfig()
</script>

<template>
  <div class="container">
    <h1>TeleCRM</h1>
    <p>API: {{ config.public.apiUrl }}</p>
  </div>
</template>

<style>
.container {
  font-family: system-ui, sans-serif;
  padding: 2rem;
  max-width: 960px;
  margin: 0 auto;
}
</style>
