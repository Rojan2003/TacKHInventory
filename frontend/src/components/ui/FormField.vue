<script setup lang="ts">
defineProps<{
  label: string
  for?: string
  error?: string | null
  help?: string
  required?: boolean
}>()
</script>

<template>
  <div>
    <label :for="$props.for" class="label">
      {{ label }}
      <span v-if="required" class="text-red-600" aria-hidden="true">*</span>
    </label>
    <slot />
    <p v-if="error" class="mt-1 text-xs text-red-600" role="alert">{{ error }}</p>
    <p v-else-if="help" class="help">{{ help }}</p>
  </div>
</template>
