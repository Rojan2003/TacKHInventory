<script setup lang="ts">
import { computed, onMounted, reactive, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Download } from 'lucide-vue-next'
import { api } from '@/services/api'
import { useAsync } from '@/composables/useAsync'
import { useAuthStore } from '@/stores/auth'
import { useReferenceStore } from '@/stores/reference'
import type { StockOverview } from '@/types/api'
import { downloadCsv, formatDate, formatDateTime, formatNumber } from '@/utils/format'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatCard from '@/components/ui/StatCard.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import DateRange from '@/components/ui/DateRange.vue'
import DataTable, { type Column } from '@/components/ui/DataTable.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import AppButton from '@/components/ui/AppButton.vue'

const auth = useAuthStore()
const reference = useReferenceStore()
const router = useRouter()
const seesAll = computed(() => auth.can('stock.view.all'))
const filters = reactive({ congregationId: auth.user?.congregationId || '', from: '', to: '' })

const { data, loading, error, reload } = useAsync<StockOverview>(() => api.call('stock.overview', { congregationId: filters.congregationId || undefined, from: filters.from || undefined, to: filters.to || undefined }), { immediate: false })

onMounted(async () => {
  await reference.loadCongregations()
  if (seesAll.value && !filters.congregationId) filters.congregationId = reference.coordinator?.congregationId || ''
  void reload()
})
watch(filters, () => void reload())

const coordinatorColumns: Column[] = [
  { key: 'sku', label: 'Code' }, { key: 'name', label: 'Literature' },
  { key: 'physicalQty', label: 'Physical', align: 'right' }, { key: 'reservedQty', label: 'Reserved', align: 'right' }, { key: 'availableQty', label: 'Available', align: 'right' },
  { key: 'receivedQty', label: 'In (period)', align: 'right', hideOnCard: true }, { key: 'releasedQty', label: 'Out (period)', align: 'right', hideOnCard: true },
]
const memberColumns: Column[] = [
  { key: 'sku', label: 'Code' }, { key: 'name', label: 'Literature' },
  { key: 'receivedQty', label: 'Confirmed received (all time)', align: 'right' }, { key: 'periodReceivedQty', label: 'Received (period)', align: 'right', hideOnCard: true },
  { key: 'inTransitQty', label: 'Released, unconfirmed', align: 'right' }, { key: 'outstandingQty', label: 'Approved, not released', align: 'right' },
]

function exportCsv() {
  if (!data.value) return
  const cols = (data.value.isCoordinator ? coordinatorColumns : memberColumns).map((c) => ({ key: c.key, label: c.label }))
  downloadCsv(`${data.value.congregation.code}_stock_${filters.from || 'all'}_${filters.to || 'now'}`, cols, data.value.items as Record<string, unknown>[])
}
</script>

<template>
  <div>
    <PageHeader title="Congregation Stock Overview" subtitle="East holds the physical stock. Other congregations are shown what they have received from East, not as physical inventory.">
      <AppButton variant="outline" size="sm" :disabled="!data" @click="exportCsv"><Download class="size-4" /> CSV</AppButton>
    </PageHeader>
    <div class="card p-3 mb-5 grid gap-2 sm:grid-cols-[auto_1fr] sm:items-center">
      <select v-if="seesAll" v-model="filters.congregationId" class="input sm:w-64" aria-label="Congregation">
        <option v-for="c in reference.congregations.filter((x) => x.active)" :key="c.congregationId" :value="c.congregationId">{{ c.name }}<template v-if="c.type === 'coordinator'"> (coordinator)</template></option>
      </select>
      <p v-else class="text-sm font-medium text-ink px-1">{{ auth.user?.congregationName }}</p>
      <DateRange v-model:from="filters.from" v-model:to="filters.to" class="sm:max-w-md" />
    </div>
    <ErrorBanner :message="error" :retry="reload" class="mb-4" />

    <template v-if="data?.isCoordinator">
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-5 mb-5">
        <StatCard label="Physical" :value="data.totals.physicalQty" tone="brand" />
        <StatCard label="Reserved" :value="data.totals.reservedQty" tone="info" />
        <StatCard label="Available" :value="data.totals.availableQty" tone="brand" />
        <StatCard label="Received in period" :value="data.totals.receivedQty" hint="Deliveries + opening" />
        <StatCard label="Released in period" :value="data.totals.releasedQty" hint="Distributions out" />
      </div>
      <div class="card overflow-hidden">
        <DataTable :columns="coordinatorColumns" :rows="data.items" row-key="itemId" :loading="loading" dense empty-title="No active items">
          <template #cell-sku="{ row }"><span class="font-mono text-xs">{{ row.sku }}</span></template>
          <template #cell-availableQty="{ row }"><span class="font-semibold tabular-nums">{{ formatNumber(row.availableQty) }}</span></template>
        </DataTable>
      </div>
    </template>

    <template v-else-if="data">
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4 mb-5">
        <StatCard label="Confirmed received (all time)" :value="data.totals.receivedQty" tone="brand" />
        <StatCard label="Received in period" :value="data.totals.periodReceivedQty" />
        <StatCard label="Released, awaiting confirmation" :value="data.totals.inTransitQty" tone="info" />
        <StatCard label="Approved, not yet released" :value="data.totals.outstandingQty" tone="warning" />
      </div>
      <div class="card overflow-hidden mb-5">
        <h2 class="font-semibold text-ink px-4 py-3 border-b border-gray-100">Literature by item</h2>
        <DataTable :columns="memberColumns" :rows="data.items" row-key="itemId" :loading="loading" dense empty-title="No literature received or requested yet">
          <template #cell-sku="{ row }"><span class="font-mono text-xs">{{ row.sku }}</span></template>
          <template #cell-receivedQty="{ row }"><span class="font-semibold tabular-nums">{{ formatNumber(row.receivedQty) }}</span></template>
        </DataTable>
      </div>
      <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section class="card overflow-hidden">
          <h2 class="font-semibold text-ink px-4 py-3 border-b border-gray-100">Requests</h2>
          <ul class="divide-y divide-gray-100 text-sm">
            <li v-if="!data.requests.length" class="px-4 py-6 text-center text-muted">No requests in this period</li>
            <li v-for="r in data.requests" :key="r.requestId" class="flex items-center justify-between gap-2 px-4 py-2.5 cursor-pointer hover:bg-brand-50/60" @click="router.push({ name: 'request-detail', params: { requestId: r.requestId } })">
              <div class="min-w-0"><p class="font-mono text-xs">{{ r.requestNumber }}</p><p class="text-xs text-muted">{{ formatDate(r.requestDate) }} · {{ formatNumber(r.requestedTotal) }} requested · {{ formatNumber(r.fulfilledTotal) }} fulfilled</p></div>
              <StatusBadge :status="r.status" size="sm" />
            </li>
          </ul>
        </section>
        <section class="card overflow-hidden">
          <h2 class="font-semibold text-ink px-4 py-3 border-b border-gray-100">Distribution history</h2>
          <ul class="divide-y divide-gray-100 text-sm">
            <li v-if="!data.distributions.length" class="px-4 py-6 text-center text-muted">No distributions in this period</li>
            <li v-for="d in data.distributions" :key="d.distributionId" class="flex items-center justify-between gap-2 px-4 py-2.5 cursor-pointer hover:bg-brand-50/60" @click="router.push({ name: 'distribution-detail', params: { distributionId: d.distributionId } })">
              <div class="min-w-0"><p class="font-mono text-xs">{{ d.reference }}</p><p class="text-xs text-muted">{{ formatDateTime(d.createdAt) }} · {{ formatNumber(d.totalQty) }} units</p></div>
              <StatusBadge :status="d.status" size="sm" />
            </li>
          </ul>
        </section>
      </div>
    </template>
    <div v-else-if="loading" class="card p-6 animate-pulse h-40" />
  </div>
</template>
