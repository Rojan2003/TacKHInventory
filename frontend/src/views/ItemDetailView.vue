<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { SlidersHorizontal } from 'lucide-vue-next'
import { api } from '@/services/api'
import { useMutation } from '@/composables/useAsync'
import { useApiQuery } from '@/composables/useApiQuery'
import { usePagedList } from '@/composables/usePagedList'
import { useAuthStore } from '@/stores/auth'
import { useReferenceStore } from '@/stores/reference'
import type { Item, LedgerEntry } from '@/types/api'
import { formatDateTime, formatNumber, signed, TXN_TYPE_LABELS } from '@/utils/format'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatCard from '@/components/ui/StatCard.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import DescriptionList from '@/components/ui/DescriptionList.vue'
import DataTable, { type Column } from '@/components/ui/DataTable.vue'
import Pagination from '@/components/ui/Pagination.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import AppButton from '@/components/ui/AppButton.vue'
import Modal from '@/components/ui/Modal.vue'
import FormField from '@/components/ui/FormField.vue'
import DateRange from '@/components/ui/DateRange.vue'

const route = useRoute()
const auth = useAuthStore()
const reference = useReferenceStore()
const itemId = computed(() => String(route.params.itemId))

const { data: item, loading, error, reload } = useApiQuery<Item>('items.get', () => ({ itemId: itemId.value }))
const history = usePagedList<LedgerEntry>('items.history', { itemId: itemId.value, from: '', to: '' }, { pageSize: 20 })

const columns: Column[] = [
  { key: 'timestamp', label: 'When' },
  { key: 'type', label: 'Type' },
  { key: 'quantity', label: 'Qty', align: 'right' },
  { key: 'balanceAfter', label: 'Balance', align: 'right' },
  { key: 'counterpartyName', label: 'Counterparty', hideOnCard: true },
  { key: 'refId', label: 'Reference', hideOnCard: true },
  { key: 'actor', label: 'By', hideOnCard: true },
]

const stockStatus = computed(() => {
  const i = item.value
  if (!i) return ''
  if (!i.active) return 'Inactive'
  if (i.physicalQty <= 0) return 'Out of stock'
  return i.isLowStock ? 'Low stock' : 'In stock'
})

/* ---- Adjustment ---- */
const adjust = reactive({ open: false, quantity: '' as number | '', reason: '' })
const adjustErrors = ref<Record<string, string>>({})
const adjustMutation = useMutation(async (requestId: string) => api.call<Item>('items.adjust', { itemId: itemId.value, quantity: adjust.quantity, reason: adjust.reason }, { requestId }), { successTitle: 'Stock adjusted' })
async function submitAdjust() {
  const e: Record<string, string> = {}
  const q = Number(adjust.quantity)
  if (adjust.quantity === '' || !Number.isInteger(q) || q === 0) e.quantity = 'Enter a non-zero whole number (negative to reduce).'
  if (!adjust.reason.trim()) e.reason = 'A reason is required for the audit trail.'
  adjustErrors.value = e
  if (Object.keys(e).length) return
  const saved = await adjustMutation.mutate()
  if (saved) { adjust.open = false; adjust.quantity = ''; adjust.reason = ''; reference.invalidate(['items']); void reload(); void history.reload() }
}
</script>

<template>
  <div>
    <PageHeader :title="item ? `${item.name}` : 'Item details'" :subtitle="item ? `${item.sku}${item.category ? ' · ' + item.category : ''}` : ''" :back-to="{ name: 'inventory' }">
      <AppButton v-if="auth.can('items.manage') && item" variant="outline" @click="adjust.open = true"><SlidersHorizontal class="size-4" /> Adjust stock</AppButton>
    </PageHeader>

    <ErrorBanner :message="error" :retry="reload" class="mb-4" />

    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4 mb-5">
      <StatCard label="Physical" :value="item?.physicalQty" :hint="item?.unit" tone="brand" :loading="loading && !item" />
      <StatCard label="Reserved" :value="item?.reservedQty" hint="Approved, not released" tone="info" :loading="loading && !item" />
      <StatCard label="Available" :value="item?.availableQty" hint="Physical − reserved" tone="brand" :loading="loading && !item" />
      <StatCard label="Minimum stock" :value="item?.lowStockThreshold" :hint="stockStatus" :tone="item?.isLowStock ? 'danger' : 'default'" :loading="loading && !item" />
    </div>

    <div class="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <section class="card p-4 lg:col-span-1">
        <div class="flex items-center justify-between mb-3"><h2 class="font-semibold text-ink">Details</h2><StatusBadge v-if="item" :status="stockStatus" /></div>
        <DescriptionList v-if="item" :cols="1" :items="[
          { label: 'Item code', value: item.sku },
          { label: 'Description', value: item.description },
          { label: 'Unit', value: item.unit },
          { label: 'Last movement', value: formatDateTime(item.lastMovementAt) },
          { label: 'Created', value: `${formatDateTime(item.createdAt)} by ${item.createdBy}` },
          { label: 'Updated', value: `${formatDateTime(item.updatedAt)} by ${item.updatedBy}` },
        ]" />
      </section>

      <section class="card lg:col-span-2 overflow-hidden">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3 border-b border-gray-100">
          <h2 class="font-semibold text-ink">Stock movement history</h2>
          <DateRange v-model:from="history.params.from as string" v-model:to="history.params.to as string" class="sm:w-80" />
        </div>
        <DataTable :columns="columns" :rows="history.page.value?.rows || []" row-key="txnId" :loading="history.loading.value" dense empty-title="No movements recorded">
          <template #cell-timestamp="{ row }"><span class="text-xs">{{ formatDateTime(row.timestamp) }}</span></template>
          <template #cell-type="{ row }">{{ TXN_TYPE_LABELS[row.type] || row.type }}<span v-if="row.notes" class="block text-xs text-muted truncate max-w-xs">{{ row.notes }}</span></template>
          <template #cell-quantity="{ row }"><span :class="['font-semibold tabular-nums', row.quantity < 0 ? 'text-red-600' : 'text-emerald-700']">{{ signed(row.quantity) }}</span></template>
          <template #cell-balanceAfter="{ row }"><span class="tabular-nums">{{ formatNumber(row.balanceAfter) }}</span></template>
          <template #cell-refId="{ row }"><span class="font-mono text-xs text-muted">{{ row.refType }}<template v-if="row.refId"> · {{ row.refId.slice(0, 14) }}</template></span></template>
        </DataTable>
        <Pagination v-if="history.page.value" :page="history.page.value.page" :total-pages="history.page.value.totalPages" :total="history.page.value.total" :page-size="history.page.value.pageSize" @update:page="(p) => (history.params.page = p)" @update:page-size="(s) => { history.params.pageSize = s; history.params.page = 1 }" />
      </section>
    </div>

    <Modal :open="adjust.open" title="Adjust stock" size="sm" @close="adjust.open = false">
      <form id="adjust-form" class="space-y-4" @submit.prevent="submitAdjust">
        <p class="text-sm text-muted">Use this for count corrections. The adjustment is posted to the ledger and attributed to you. Stock can never go below zero.</p>
        <FormField label="Quantity (+ to add, − to reduce)" for="a-qty" required :error="adjustErrors.quantity"><input id="a-qty" v-model="adjust.quantity" type="number" step="1" inputmode="numeric" class="input" :class="adjustErrors.quantity ? 'input-error' : ''" placeholder="-3" /></FormField>
        <FormField label="Reason" for="a-reason" required :error="adjustErrors.reason"><textarea id="a-reason" v-model="adjust.reason" class="input" rows="3" maxlength="500" placeholder="Physical count on 20 Oct found 3 damaged copies" /></FormField>
        <p v-if="item" class="text-xs text-muted">Current physical: {{ formatNumber(item.physicalQty) }} → after: <strong>{{ formatNumber(item.physicalQty + (Number(adjust.quantity) || 0)) }}</strong></p>
      </form>
      <template #footer>
        <AppButton variant="outline" @click="adjust.open = false">Cancel</AppButton>
        <AppButton type="submit" form="adjust-form" :loading="adjustMutation.pending.value">Post adjustment</AppButton>
      </template>
    </Modal>
  </div>
</template>
