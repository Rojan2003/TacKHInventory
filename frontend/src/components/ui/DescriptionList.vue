<script setup lang="ts">
defineProps<{ items: { label: string; value: string | number | null | undefined }[]; cols?: 1 | 2 | 3 }>()
</script>

<template>
  <dl :class="['grid gap-x-6 gap-y-3 text-sm', cols === 3 ? 'sm:grid-cols-3' : cols === 1 ? '' : 'sm:grid-cols-2']">
    <div v-for="it in items" :key="it.label" class="min-w-0">
      <dt class="text-xs font-medium uppercase tracking-wide text-muted">{{ it.label }}</dt>
      <dd class="mt-0.5 text-ink break-words whitespace-pre-line">{{ it.value === '' || it.value === null || it.value === undefined ? '—' : it.value }}</dd>
    </div>
  </dl>
</template>
