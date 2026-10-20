<script setup lang="ts">
import type { Component } from 'vue'
import { Inbox } from 'lucide-vue-next'

defineProps<{ title: string; message?: string; icon?: Component }>()
</script>

<template>
  <div class="flex flex-col items-center justify-center text-center px-4">
    <div class="rounded-full bg-brand-50 p-3 text-brand-600">
      <component :is="icon || Inbox" class="size-6" aria-hidden="true" />
    </div>
    <p class="mt-3 text-sm font-medium text-ink">{{ title }}</p>
    <p v-if="message" class="mt-1 text-sm text-muted max-w-sm">{{ message }}</p>
    <div v-if="$slots.default" class="mt-4"><slot /></div>
  </div>
</template>
