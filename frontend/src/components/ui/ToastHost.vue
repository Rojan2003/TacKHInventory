<script setup lang="ts">
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-vue-next'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()
const ICONS = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle }
const STYLES = { success: 'border-emerald-200 text-emerald-700', error: 'border-red-200 text-red-700', info: 'border-blue-200 text-blue-700', warning: 'border-amber-200 text-amber-700' }
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:right-4 sm:left-auto" aria-live="polite" aria-atomic="false">
    <TransitionGroup enter-active-class="transition duration-200" enter-from-class="opacity-0 -translate-y-2" leave-active-class="transition duration-150" leave-to-class="opacity-0">
      <div v-for="t in toast.toasts" :key="t.id" :class="['pointer-events-auto w-full max-w-sm rounded-xl border bg-white p-3 shadow-lg flex gap-3', STYLES[t.kind]]" role="status">
        <component :is="ICONS[t.kind]" class="size-5 shrink-0 mt-0.5" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-ink">{{ t.title }}</p>
          <p v-if="t.message" class="text-sm text-muted mt-0.5 break-words">{{ t.message }}</p>
        </div>
        <button type="button" class="shrink-0 rounded-lg p-1 text-muted hover:bg-gray-100" aria-label="Dismiss" @click="toast.dismiss(t.id)"><X class="size-4" /></button>
      </div>
    </TransitionGroup>
  </div>
</template>
