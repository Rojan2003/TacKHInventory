<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Plus, Trash2 } from 'lucide-vue-next'
import { useReferenceStore } from '@/stores/reference'
import { formatNumber } from '@/utils/format'
import AppButton from '@/components/ui/AppButton.vue'

export interface LineDraft { key: number; itemId: string; quantity: number | '' }

const props = withDefaults(defineProps<{
  modelValue: LineDraft[]
  /** Restrict picker to these item IDs (e.g. items on a request) and show their limits. */
  allowedItems?: { itemId: string; max?: number; hint?: string }[]
  showAvailable?: boolean
  disabled?: boolean
  errors?: Record<number, string>
  quantityLabel?: string
}>(), { showAvailable: true, disabled: false, quantityLabel: 'Quantity' })

const emit = defineEmits<{ 'update:modelValue': [lines: LineDraft[]] }>()
const reference = useReferenceStore()
const loading = ref(false)
let nextKey = Date.now()

onMounted(async () => {
  loading.value = true
  try { await reference.loadItems(true) } finally { loading.value = false }
})

const options = computed(() => {
  const allowed = props.allowedItems ? new Set(props.allowedItems.map((a) => a.itemId)) : null
  return reference.items.filter((i) => i.active && (!allowed || allowed.has(i.itemId)))
})

function limitFor(itemId: string) {
  return props.allowedItems?.find((a) => a.itemId === itemId)
}

function update(lines: LineDraft[]) { emit('update:modelValue', lines) }
function add() { update([...props.modelValue, { key: nextKey++, itemId: '', quantity: '' }]) }
function remove(key: number) { update(props.modelValue.filter((l) => l.key !== key)) }
function patch(key: number, p: Partial<LineDraft>) { update(props.modelValue.map((l) => (l.key === key ? { ...l, ...p } : l))) }

const total = computed(() => props.modelValue.reduce((s, l) => s + (Number(l.quantity) || 0), 0))
</script>

<template>
  <div class="space-y-3">
    <div v-if="loading" class="text-sm text-muted">Loading literature items…</div>
    <div v-for="(line, idx) in modelValue" :key="line.key" class="rounded-xl border border-gray-200 p-3 sm:flex sm:items-start sm:gap-3">
      <div class="flex-1">
        <label class="label" :for="`line-item-${line.key}`">Literature item</label>
        <select :id="`line-item-${line.key}`" class="input" :class="errors?.[idx] ? 'input-error' : ''" :value="line.itemId" :disabled="disabled" @change="patch(line.key, { itemId: ($event.target as HTMLSelectElement).value })">
          <option value="" disabled>Select an item…</option>
          <option v-for="o in options" :key="o.itemId" :value="o.itemId" :disabled="modelValue.some((l) => l.itemId === o.itemId && l.key !== line.key)">
            {{ o.sku }} — {{ o.name }}<template v-if="showAvailable"> (available {{ formatNumber(o.availableQty) }})</template>
          </option>
        </select>
        <p v-if="line.itemId && limitFor(line.itemId)?.hint" class="help">{{ limitFor(line.itemId)?.hint }}</p>
        <p v-if="errors?.[idx]" class="mt-1 text-xs text-red-600" role="alert">{{ errors[idx] }}</p>
      </div>
      <div class="mt-3 sm:mt-0 sm:w-36">
        <label class="label" :for="`line-qty-${line.key}`">{{ quantityLabel }}</label>
        <input :id="`line-qty-${line.key}`" type="number" inputmode="numeric" min="1" step="1" :max="limitFor(line.itemId)?.max" class="input" :value="line.quantity" :disabled="disabled" @input="patch(line.key, { quantity: ($event.target as HTMLInputElement).value === '' ? '' : Number(($event.target as HTMLInputElement).value) })" />
      </div>
      <div class="mt-3 sm:mt-7 flex justify-end">
        <button type="button" class="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-sm text-red-600 hover:bg-red-50 min-h-11" :disabled="disabled" aria-label="Remove line" @click="remove(line.key)"><Trash2 class="size-4" /><span class="sm:hidden">Remove</span></button>
      </div>
    </div>
    <div class="flex items-center justify-between">
      <AppButton variant="secondary" size="sm" :disabled="disabled" @click="add"><Plus class="size-4" /> Add item</AppButton>
      <p class="text-sm text-muted">Total units: <span class="font-semibold text-ink tabular-nums">{{ formatNumber(total) }}</span></p>
    </div>
  </div>
</template>
