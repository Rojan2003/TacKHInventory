<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'

const props = withDefaults(defineProps<{ open: boolean; title: string; size?: 'sm' | 'md' | 'lg' | 'xl'; persistent?: boolean; /** Stacks above other modals (used by the confirm dialog, which may open from inside a modal). */ above?: boolean }>(), { size: 'md', persistent: false, above: false })
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement | null>(null)

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open && !props.persistent) emit('close')
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
watch(() => props.open, (o) => {
  document.body.style.overflow = o ? 'hidden' : ''
  if (o) setTimeout(() => panel.value?.querySelector<HTMLElement>('input, select, textarea, button')?.focus(), 30)
})

const SIZES = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }
</script>

<template>
  <Teleport to="body">
    <Transition enter-active-class="transition duration-150" enter-from-class="opacity-0" leave-active-class="transition duration-100" leave-to-class="opacity-0">
      <div v-if="open" :class="['fixed inset-0 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4', above ? 'z-[55]' : 'z-50']" @click.self="!persistent && emit('close')">
        <div ref="panel" role="dialog" aria-modal="true" :aria-label="title" :class="['w-full bg-white shadow-xl rounded-t-2xl sm:rounded-2xl max-h-[92dvh] flex flex-col', SIZES[size]]">
          <div class="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
            <h2 class="text-base font-semibold text-ink">{{ title }}</h2>
            <button type="button" class="rounded-lg p-2 text-muted hover:bg-gray-100 min-h-9 min-w-9" aria-label="Close" @click="emit('close')">
              <X class="size-5" />
            </button>
          </div>
          <div class="overflow-y-auto px-5 py-4 flex-1">
            <slot />
          </div>
          <div v-if="$slots.footer" class="border-t border-gray-100 px-5 py-3 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 bg-gray-50/60 rounded-b-2xl">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
