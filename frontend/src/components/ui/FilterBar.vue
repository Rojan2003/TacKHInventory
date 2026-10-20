<script setup lang="ts">
import { Search, X, SlidersHorizontal } from 'lucide-vue-next'
import { ref } from 'vue'

defineProps<{ query?: string; placeholder?: string; showClear?: boolean }>()
const emit = defineEmits<{ 'update:query': [value: string]; clear: [] }>()
const expanded = ref(false)
</script>

<template>
  <div class="border-b border-gray-100 p-3 space-y-3">
    <div class="flex gap-2">
      <label class="relative flex-1">
        <span class="sr-only">Search</span>
        <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
        <input type="search" class="input pl-9" :placeholder="placeholder || 'Search…'" :value="query" @input="emit('update:query', ($event.target as HTMLInputElement).value)" />
      </label>
      <button v-if="$slots.default" type="button" class="md:hidden inline-flex items-center gap-1 rounded-xl border border-gray-300 px-3 text-sm min-h-11" :aria-expanded="expanded" @click="expanded = !expanded">
        <SlidersHorizontal class="size-4" /> Filters
      </button>
      <button v-if="showClear" type="button" class="hidden md:inline-flex items-center gap-1 rounded-xl border border-gray-300 px-3 text-sm text-muted hover:bg-gray-50 min-h-11" @click="emit('clear')">
        <X class="size-4" /> Clear
      </button>
    </div>
    <div v-if="$slots.default" :class="['grid gap-2 sm:grid-cols-2 lg:grid-cols-4', expanded ? '' : 'hidden md:grid']">
      <slot />
      <button v-if="showClear" type="button" class="md:hidden inline-flex items-center justify-center gap-1 rounded-xl border border-gray-300 px-3 text-sm text-muted min-h-11" @click="emit('clear')">
        <X class="size-4" /> Clear filters
      </button>
    </div>
  </div>
</template>
