<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, Eye } from 'lucide-vue-next'
import { usePagedList } from '@/composables/usePagedList'
import { useAuthStore } from '@/stores/auth'
import { useReferenceStore } from '@/stores/reference'
import type { Distribution } from '@/types/api'
import { formatDateTime, formatNumber } from '@/utils/format'
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
const router = useRouter()
void reference.loadCongregations()
const canCreate = computed(() => auth.can('distributions.create'))
const seesAll = computed(() => auth.can('distributions.view.all'))

const list = usePagedList<Distribution>('distributions.list', { sortBy: 'createdAt', sortDir: 'desc', status: '', congregationId: '', from: '', to: '' })

const columns: Column[] = [
  { key: 'reference', label: 'Reference', sortable: true },
  { key: 'createdAt', label: 'Released', sortable: true },
  { key: 'destinationName', label: 'Congregation', sortable: true },
  { key: 'requestNumber', label: 'Request', hideOnCard: true },
  { key: 'totalQty', label: 'Units', align: 'right', sortable: true },
  { key: 'releasedBy', label: 'Released by', hideOnCard: true },
  { key: 'status', label: 'Status', sortable: true, align: 'center' },
]
</script>

<template>
  <div>
    <PageHeader title="Distributions" subtitle="Literature released from East to the congregations. Each release deducts stock once.">
      <AppButton v-if="canCreate" :to="{ name: 'distribution-new' }"><Plus class="size-4" /> Release literature</AppButton>
    </PageHeader>
    <ErrorBanner :message="list.error.value" :retry="list.reload" class="mb-4" />
    <div class="card overflow-hidden">
      <FilterBar v-model:query="list.params.query as string" placeholder="Search reference, request, congregation…" show-clear @clear="list.resetFilters()">
        <select v-model="list.params.status" class="input" aria-label="Status"><option value="">All statuses</option><option>Released</option><option>Received</option></select>
        <select v-if="seesAll" v-model="list.params.congregationId" class="input" aria-label="Congregation"><option value="">All congregations</option><option v-for="c in reference.memberCongregations" :key="c.congregationId" :value="c.congregationId">{{ c.name }}</option></select>
        <DateRange v-model:from="list.params.from as string" v-model:to="list.params.to as string" class="sm:col-span-2" />
      </FilterBar>
      <DataTable :columns="columns" :rows="list.page.value?.rows || []" row-key="distributionId" :loading="list.loading.value" :sort-by="list.params.sortBy" :sort-dir="list.params.sortDir" clickable empty-title="No distributions found" @sort="list.sort" @row-click="(r) => router.push({ name: 'distribution-detail', params: { distributionId: r.distributionId } })">
        <template #cell-reference="{ row }"><span class="font-mono text-xs font-medium">{{ row.reference }}</span></template>
        <template #cell-createdAt="{ row }"><span class="text-xs">{{ formatDateTime(row.createdAt) }}</span></template>
        <template #cell-requestNumber="{ row }"><span class="font-mono text-xs">{{ row.requestNumber || '—' }}</span></template>
        <template #cell-totalQty="{ row }"><span class="tabular-nums font-medium">{{ formatNumber(row.totalQty) }}</span></template>
        <template #cell-status="{ row }"><StatusBadge :status="row.status" size="sm" /></template>
        <template #card="{ row }">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0"><p class="font-mono text-xs text-muted">{{ row.reference }}</p><p class="font-medium text-ink truncate">{{ row.destinationName }}</p><p class="text-xs text-muted">{{ formatDateTime(row.createdAt) }} · {{ formatNumber(row.totalQty) }} units<span v-if="row.requestNumber"> · {{ row.requestNumber }}</span></p></div>
            <StatusBadge :status="row.status" size="sm" />
          </div>
        </template>
        <template #actions="{ row }"><AppButton variant="ghost" size="sm" :to="{ name: 'distribution-detail', params: { distributionId: row.distributionId } }"><Eye class="size-4" /><span class="md:sr-only">View</span></AppButton></template>
      </DataTable>
      <Pagination v-if="list.page.value" :page="list.page.value.page" :total-pages="list.page.value.totalPages" :total="list.page.value.total" :page-size="list.page.value.pageSize" @update:page="(p) => (list.params.page = p)" @update:page-size="(s) => { list.params.pageSize = s; list.params.page = 1 }" />
    </div>
  </div>
</template>
