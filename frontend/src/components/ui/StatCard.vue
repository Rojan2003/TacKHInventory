<script setup lang="ts">
import type { Component } from 'vue'
import { formatNumber } from '@/utils/format'

defineProps<{
  label: string
  value: number | string | null | undefined
  hint?: string
  icon?: Component
  tone?: 'default' | 'brand' | 'warning' | 'danger' | 'info'
  loading?: boolean
  to?: string | Record<string, unknown>
}>()

const TONES = {
  default: 'bg-gray-100 text-gray-600',
  brand: 'bg-brand-50 text-brand-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-red-50 text-red-700',
  info: 'bg-blue-50 text-blue-700',
}
</script>

<template>
  <component :is="to ? 'RouterLink' : 'div'" :to="to" class="card p-4 flex items-start gap-3 min-w-0" :class="to ? 'hover:border-brand-300 transition-colors' : ''">
    <div v-if="icon" :class="['shrink-0 rounded-xl p-2.5', TONES[tone || 'default']]">
      <component :is="icon" class="size-5" aria-hidden="true" />
    </div>
    <div class="min-w-0 flex-1">
      <p class="text-xs font-medium uppercase tracking-wide text-muted truncate">{{ label }}</p>
      <div v-if="loading" class="mt-1.5 h-7 w-20 animate-pulse rounded bg-gray-200" />
      <p v-else class="mt-0.5 text-2xl font-semibold text-ink tabular-nums">{{ typeof value === 'number' ? formatNumber(value) : (value ?? '—') }}</p>
      <p v-if="hint" class="text-xs text-muted mt-0.5 truncate">{{ hint }}</p>
    </div>
  </component>
</template>
