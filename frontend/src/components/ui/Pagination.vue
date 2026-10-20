<script setup lang="ts">
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { formatNumber } from '@/utils/format'

defineProps<{ page: number; totalPages: number; total: number; pageSize: number }>()
const emit = defineEmits<{ 'update:page': [page: number]; 'update:pageSize': [size: number] }>()
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-3 py-2.5 text-sm text-muted">
    <div class="flex items-center gap-2">
      <span>{{ formatNumber(total) }} {{ total === 1 ? 'record' : 'records' }}</span>
      <label class="sr-only" for="page-size">Rows per page</label>
      <select id="page-size" class="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs" :value="pageSize" @change="emit('update:pageSize', Number(($event.target as HTMLSelectElement).value))">
        <option v-for="n in [10, 20, 50, 100]" :key="n" :value="n">{{ n }} / page</option>
      </select>
    </div>
    <div class="flex items-center gap-1">
      <button type="button" class="rounded-lg p-2 hover:bg-gray-100 disabled:opacity-40 min-h-9 min-w-9" :disabled="page <= 1" aria-label="Previous page" @click="emit('update:page', page - 1)">
        <ChevronLeft class="size-4" />
      </button>
      <span class="px-2 tabular-nums">Page {{ page }} of {{ totalPages }}</span>
      <button type="button" class="rounded-lg p-2 hover:bg-gray-100 disabled:opacity-40 min-h-9 min-w-9" :disabled="page >= totalPages" aria-label="Next page" @click="emit('update:page', page + 1)">
        <ChevronRight class="size-4" />
      </button>
    </div>
  </div>
</template>
