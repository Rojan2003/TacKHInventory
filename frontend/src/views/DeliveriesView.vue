<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus, Eye } from 'lucide-vue-next'
import { usePagedList } from '@/composables/usePagedList'
import { useAuthStore } from '@/stores/auth'
import { useReferenceStore } from '@/stores/reference'
import type { Delivery } from '@/types/api'
import { formatDate, formatNumber } from '@/utils/format'
import PageHeader from '@/components/ui/PageHeader.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import DataTable, { type Column } from '@/components/ui/DataTable.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import AppButton from '@/components/ui/AppButton.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import DateRange from '@/components/ui/DateRange.vue'

const auth = useAuthStore()
const reference = useReferenceStore()
const route = useRoute()
const router = useRouter()
const canManage = computed(() => auth.can('deliveries.manage'))
void reference.loadCongregations()

const list = usePagedList<Delivery>('deliveries.list', { sortBy: 'deliveryDate', sortDir: 'desc', status: (route.query.status as string) || '', sourceCongregationId: '', from: '', to: '' })

const columns: Column[] = [
  { key: 'reference', label: 'Reference', sortable: true },
  { key: 'deliveryDate', label: 'Date', sortable: true },
  { key: 'sourceName', label: 'Source', sortable: true },
  { key: 'itemCount', label: 'Lines', align: 'right', hideOnCard: true },
  { key: 'totalQty', label: 'Units', align: 'right', sortable: true },
  { key: 'receivedBy', label: 'Received by', hideOnCard: true },
  { key: 'status', label: 'Status', sortable: true, align: 'center' },
]
</script>

<template>
  <div>
    <PageHeader title="Incoming Deliveries" subtitle="Only confirmed deliveries increase physical stock.">
      <AppButton v-if="canManage" :to="{ name: 'delivery-new' }"><Plus class="size-4" /> Record delivery</AppButton>
    </PageHeader>
    <ErrorBanner :message="list.error.value" :retry="list.reload" class="mb-4" />
    <div class="card overflow-hidden">
      <FilterBar v-model:query="list.params.query as string" placeholder="Search reference, source, receiver…" show-clear @clear="list.resetFilters()">
        <select v-model="list.params.status" class="input" aria-label="Status"><option value="">All statuses</option><option>Pending</option><option>Confirmed</option><option>Cancelled</option></select>
        <select v-model="list.params.sourceCongregationId" class="input" aria-label="Source congregation"><option value="">Any source</option><option v-for="c in reference.congregations" :key="c.congregationId" :value="c.congregationId">{{ c.name }}</option></select>
        <DateRange v-model:from="list.params.from as string" v-model:to="list.params.to as string" class="sm:col-span-2" />
      </FilterBar>
      <DataTable :columns="columns" :rows="list.page.value?.rows || []" row-key="deliveryId" :loading="list.loading.value" :sort-by="list.params.sortBy" :sort-dir="list.params.sortDir" clickable empty-title="No deliveries found" @sort="list.sort" @row-click="(r) => router.push({ name: 'delivery-detail', params: { deliveryId: r.deliveryId } })">
        <template #cell-reference="{ row }"><span class="font-mono text-xs font-medium">{{ row.reference }}</span></template>
        <template #cell-deliveryDate="{ row }">{{ formatDate(row.deliveryDate) }}</template>
        <template #cell-sourceName="{ row }">{{ row.sourceName }}<span class="block text-xs text-muted capitalize">{{ row.sourceType }}</span></template>
        <template #cell-totalQty="{ row }"><span class="tabular-nums font-medium">{{ formatNumber(row.totalQty) }}</span></template>
        <template #cell-status="{ row }"><StatusBadge :status="row.status" size="sm" /></template>
        <template #card="{ row }">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0"><p class="font-mono text-xs text-muted">{{ row.reference }}</p><p class="font-medium text-ink truncate">{{ row.sourceName }}</p><p class="text-xs text-muted">{{ formatDate(row.deliveryDate) }} · {{ row.itemCount }} lines · {{ formatNumber(row.totalQty) }} units</p></div>
            <StatusBadge :status="row.status" size="sm" />
          </div>
        </template>
        <template #actions="{ row }"><AppButton variant="ghost" size="sm" :to="{ name: 'delivery-detail', params: { deliveryId: row.deliveryId } }"><Eye class="size-4" /><span class="md:sr-only">View</span></AppButton></template>
      </DataTable>
      <Pagination v-if="list.page.value" :page="list.page.value.page" :total-pages="list.page.value.totalPages" :total="list.page.value.total" :page-size="list.page.value.pageSize" @update:page="(p) => (list.params.page = p)" @update:page-size="(s) => { list.params.pageSize = s; list.params.page = 1 }" />
    </div>
  </div>
</template>
