<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ status: string; size?: 'sm' | 'md' }>()

const STYLES: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700',
  Pending: 'bg-amber-100 text-amber-800',
  Approved: 'bg-blue-100 text-blue-800',
  'Partially Fulfilled': 'bg-indigo-100 text-indigo-800',
  Fulfilled: 'bg-emerald-100 text-emerald-800',
  Rejected: 'bg-red-100 text-red-800',
  Cancelled: 'bg-gray-200 text-gray-600',
  Confirmed: 'bg-emerald-100 text-emerald-800',
  Processing: 'bg-amber-100 text-amber-800',
  Released: 'bg-blue-100 text-blue-800',
  Received: 'bg-emerald-100 text-emerald-800',
  Failed: 'bg-red-100 text-red-800',
  Active: 'bg-emerald-100 text-emerald-800',
  Inactive: 'bg-gray-200 text-gray-600',
  'Low stock': 'bg-red-100 text-red-800',
  'In stock': 'bg-emerald-100 text-emerald-800',
  'Out of stock': 'bg-red-100 text-red-800',
}

const cls = computed(() => STYLES[props.status] || 'bg-gray-100 text-gray-700')
</script>

<template>
  <span :class="['inline-flex items-center rounded-full font-medium whitespace-nowrap', size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs', cls]">
    {{ status }}
  </span>
</template>
