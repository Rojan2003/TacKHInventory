<script setup lang="ts">
import { computed } from 'vue'
import { Loader2 } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  type?: 'button' | 'submit'
  loading?: boolean
  disabled?: boolean
  block?: boolean
  to?: string | Record<string, unknown>
}>(), { variant: 'primary', size: 'md', type: 'button', loading: false, disabled: false, block: false })

const classes = computed(() => {
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-50 disabled:cursor-not-allowed select-none'
  const size = { sm: 'px-3 py-1.5 text-sm min-h-9', md: 'px-4 py-2.5 text-sm min-h-11', lg: 'px-5 py-3 text-base min-h-12' }[props.size]
  const variant = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
    secondary: 'bg-brand-50 text-brand-800 hover:bg-brand-100',
    outline: 'border border-gray-300 bg-white text-ink hover:bg-gray-50',
    ghost: 'text-ink hover:bg-gray-100',
    danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
  }[props.variant]
  return [base, size, variant, props.block ? 'w-full' : ''].join(' ')
})
</script>

<template>
  <RouterLink v-if="to" :to="to" :class="classes" :aria-disabled="disabled || loading">
    <slot />
  </RouterLink>
  <button v-else :type="type" :class="classes" :disabled="disabled || loading" :aria-busy="loading">
    <Loader2 v-if="loading" class="size-4 animate-spin" aria-hidden="true" />
    <slot />
  </button>
</template>
