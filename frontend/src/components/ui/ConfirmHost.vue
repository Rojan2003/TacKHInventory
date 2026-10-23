<script setup lang="ts">
import { AlertTriangle } from 'lucide-vue-next'
import Modal from './Modal.vue'
import AppButton from './AppButton.vue'
import { confirmState, settleConfirm } from '@/composables/useConfirm'
</script>

<template>
  <Modal above :open="confirmState.open" :title="confirmState.title" size="sm" @close="settleConfirm(false)">
    <div class="flex gap-3">
      <div v-if="confirmState.danger" class="shrink-0 rounded-full bg-red-50 p-2 text-red-600"><AlertTriangle class="size-5" /></div>
      <div class="flex-1 space-y-3">
        <p v-if="confirmState.message" class="text-sm text-muted whitespace-pre-line">{{ confirmState.message }}</p>
        <div v-if="confirmState.inputLabel">
          <label class="label" for="confirm-input">{{ confirmState.inputLabel }}<span v-if="confirmState.requireInput" class="text-red-600"> *</span></label>
          <textarea id="confirm-input" v-model="confirmState.input" class="input" rows="3" :placeholder="confirmState.inputPlaceholder" />
        </div>
      </div>
    </div>
    <template #footer>
      <AppButton variant="outline" @click="settleConfirm(false)">{{ confirmState.cancelText }}</AppButton>
      <AppButton :variant="confirmState.danger ? 'danger' : 'primary'" :disabled="!!confirmState.requireInput && !confirmState.input.trim()" @click="settleConfirm(true)">{{ confirmState.confirmText }}</AppButton>
    </template>
  </Modal>
</template>
