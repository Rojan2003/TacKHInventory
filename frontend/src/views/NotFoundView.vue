<script setup lang="ts">
import { SearchX } from 'lucide-vue-next'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppButton from '@/components/ui/AppButton.vue'
</script>

<template>
  <EmptyState :icon="SearchX" title="Page not found" message="The page you are looking for does not exist." class="py-20">
    <AppButton :to="{ name: 'dashboard' }" variant="secondary">Go to dashboard</AppButton>
  </EmptyState>
</template>
