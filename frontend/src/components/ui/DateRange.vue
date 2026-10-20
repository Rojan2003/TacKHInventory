<script setup lang="ts">
defineProps<{ from: string; to: string; label?: string }>()
const emit = defineEmits<{ 'update:from': [v: string]; 'update:to': [v: string] }>()
</script>

<template>
  <div class="flex items-center gap-2">
    <label class="flex-1">
      <span class="sr-only">{{ label || 'From' }} from</span>
      <input type="date" class="input" :value="from" :max="to || undefined" @input="emit('update:from', ($event.target as HTMLInputElement).value)" />
    </label>
    <span class="text-muted text-sm">to</span>
    <label class="flex-1">
      <span class="sr-only">{{ label || 'To' }} to</span>
      <input type="date" class="input" :value="to" :min="from || undefined" @input="emit('update:to', ($event.target as HTMLInputElement).value)" />
    </label>
  </div>
</template>
