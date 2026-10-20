<script setup lang="ts">
import { AlertTriangle, RefreshCw } from 'lucide-vue-next'

defineProps<{ message: string | null | undefined; retry?: () => unknown }>()
</script>

<template>
  <div v-if="message" class="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
    <AlertTriangle class="size-5 shrink-0" />
    <p class="flex-1">{{ message }}</p>
    <button v-if="retry" type="button" class="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium hover:bg-red-100" @click="retry()"><RefreshCw class="size-4" /> Retry</button>
  </div>
</template>
