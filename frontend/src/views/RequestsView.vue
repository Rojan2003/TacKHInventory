<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus, Eye } from 'lucide-vue-next'
import { usePagedList } from '@/composables/usePagedList'
import { useAuthStore } from '@/stores/auth'
import { useReferenceStore } from '@/stores/reference'
import { REQUEST_STATUSES, type LiteratureRequest } from '@/types/api'
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
void reference.loadCongregations()
const canCreate = computed(() => auth.can('requests.create'))
const seesAll = computed(() => auth.can('requests.view.all'))

const list = usePagedList<LiteratureRequest>('requests.list', { sortBy: 'requestDate', sortDir: 'desc', status: (route.query.status as string) || '', congregationId: '', from: '', to: '' })

const columns: Column[] = [
  { key: 'requestNumber', label: 'Request', sortable: true },
  { key: 'requestDate', label: 'Date', sortable: true },
  { key: 'congregationName', label: 'Congregation', sortable: true },
  { key: 'requestedTotal', label: 'Requested', align: 'right', hideOnCard: true },
  { key: 'approvedTotal', label: 'Approved', align: 'right', hideOnCard: true },
  { key: 'fulfilledTotal', label: 'Fulfilled', align: 'right' },
  { key: 'status', label: 'Status', sortable: true, align: 'center' },
]
</script>

<template>
  <div>
    <PageHeader title="Congregation Requests" :subtitle="seesAll ? 'Requests from all congregations.' : `Requests for ${auth.user?.congregationName || 'your congregation'}.`">
      <AppButton v-if="canCreate" :to="{ name: 'request-new' }"><Plus class="size-4" /> New request</AppButton>
    </PageHeader>
    <ErrorBanner :message="list.error.value" :retry="list.reload" class="mb-4" />
    <div class="card overflow-hidden">
      <FilterBar v-model:query="list.params.query as string" placeholder="Search request number, congregation, requester…" show-clear @clear="list.resetFilters()">
        <select v-model="list.params.status" class="input" aria-label="Status"><option value="">All statuses</option><option v-for="s in REQUEST_STATUSES" :key="s">{{ s }}</option></select>
        <select v-if="seesAll" v-model="list.params.congregationId" class="input" aria-label="Congregation"><option value="">All congregations</option><option v-for="c in reference.memberCongregations" :key="c.congregationId" :value="c.congregationId">{{ c.name }}</option></select>
        <DateRange v-model:from="list.params.from as string" v-model:to="list.params.to as string" class="sm:col-span-2" />
      </FilterBar>
      <DataTable :columns="columns" :rows="list.page.value?.rows || []" row-key="requestId" :loading="list.loading.value" :sort-by="list.params.sortBy" :sort-dir="list.params.sortDir" clickable empty-title="No requests found" @sort="list.sort" @row-click="(r) => router.push({ name: 'request-detail', params: { requestId: r.requestId } })">
        <template #cell-requestNumber="{ row }"><span class="font-mono text-xs font-medium">{{ row.requestNumber }}</span><span class="block text-xs text-muted">{{ row.requestedBy }}</span></template>
        <template #cell-requestDate="{ row }">{{ formatDate(row.requestDate) }}</template>
        <template #cell-requestedTotal="{ row }"><span class="tabular-nums">{{ formatNumber(row.requestedTotal) }}</span></template>
        <template #cell-approvedTotal="{ row }"><span class="tabular-nums">{{ formatNumber(row.approvedTotal) }}</span></template>
        <template #cell-fulfilledTotal="{ row }"><span class="tabular-nums">{{ formatNumber(row.fulfilledTotal) }}<span v-if="row.approvedTotal" class="text-xs text-muted"> / {{ formatNumber(row.approvedTotal) }}</span></span></template>
        <template #cell-status="{ row }"><StatusBadge :status="row.status" size="sm" /></template>
        <template #card="{ row }">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0"><p class="font-mono text-xs text-muted">{{ row.requestNumber }}</p><p class="font-medium text-ink truncate">{{ row.congregationName }}</p><p class="text-xs text-muted">{{ formatDate(row.requestDate) }} · {{ formatNumber(row.requestedTotal) }} requested · {{ formatNumber(row.fulfilledTotal) }} fulfilled</p></div>
            <StatusBadge :status="row.status" size="sm" />
          </div>
        </template>
        <template #actions="{ row }"><AppButton variant="ghost" size="sm" :to="{ name: 'request-detail', params: { requestId: row.requestId } }"><Eye class="size-4" /><span class="md:sr-only">View</span></AppButton></template>
      </DataTable>
      <Pagination v-if="list.page.value" :page="list.page.value.page" :total-pages="list.page.value.totalPages" :total="list.page.value.total" :page-size="list.page.value.pageSize" @update:page="(p) => (list.params.page = p)" @update:page-size="(s) => { list.params.pageSize = s; list.params.page = 1 }" />
    </div>
  </div>
</template>
