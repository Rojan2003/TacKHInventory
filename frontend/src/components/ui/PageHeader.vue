<script setup lang="ts">
defineProps<{ title: string; subtitle?: string; backTo?: string | Record<string, unknown> }>()
</script>

<template>
  <div class="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div class="min-w-0">
      <RouterLink v-if="backTo" :to="backTo" class="text-xs text-brand-700 hover:underline">&larr; Back</RouterLink>
      <h1 class="text-xl sm:text-2xl font-semibold text-ink truncate">{{ title }}</h1>
      <p v-if="subtitle" class="text-sm text-muted mt-0.5">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.default" class="flex flex-wrap gap-2 sm:justify-end"><slot /></div>
  </div>
</template>
