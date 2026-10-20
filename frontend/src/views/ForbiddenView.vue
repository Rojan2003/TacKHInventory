<script setup lang="ts">
import { ShieldOff } from 'lucide-vue-next'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppButton from '@/components/ui/AppButton.vue'
</script>

<template>
  <EmptyState :icon="ShieldOff" title="You don't have access to this page" message="Your role does not include this area. Contact the administrator if you believe this is a mistake." class="py-20">
    <AppButton :to="{ name: 'dashboard' }" variant="secondary">Go to dashboard</AppButton>
  </EmptyState>
</template>
