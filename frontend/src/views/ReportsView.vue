<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { Download, Printer, Play } from 'lucide-vue-next'
import { api, describeError } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { useReferenceStore } from '@/stores/reference'
import type { Report } from '@/types/api'
import { downloadCsv, formatDateTime, formatNumber, monthStartIso, todayIso } from '@/utils/format'
import PageHeader from '@/components/ui/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import DateRange from '@/components/ui/DateRange.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const auth = useAuthStore()
const reference = useReferenceStore()
const route = useRoute()
const seesAll = computed(() => auth.can('reports.view'))

const ALL_TYPES = [
  { key: 'inventory', label: 'Current inventory', all: true, dated: false },
  { key: 'lowStock', label: 'Low-stock items', all: true, dated: false },
  { key: 'deliveries', label: 'Incoming deliveries', all: true, dated: true },
  { key: 'distributions', label: 'Distribution history', all: false, dated: true },
  { key: 'requests', label: 'Requests and fulfilment', all: false, dated: true },
  { key: 'transactions', label: 'Stock movements (ledger)', all: true, dated: true },
  { key: 'congregationSummary', label: 'Congregation stock summary', all: false, dated: true },
  { key: 'monthly', label: 'Monthly summary', all: true, dated: true },
  { key: 'legacyEastInventory', label: 'Legacy: East_Inventory worksheet', all: true, dated: true },
  { key: 'legacyDistribution', label: 'Legacy: Distribution worksheet', all: true, dated: true },
]
const types = computed(() => ALL_TYPES.filter((t) => seesAll.value || !t.all))

const filters = reactive({ type: (route.query.type as string) || 'inventory', from: '', to: '', congregationId: '', preset: 'all' })
const report = ref<Report | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const currentType = computed(() => ALL_TYPES.find((t) => t.key === filters.type))

onMounted(() => { void reference.loadCongregations(); void run() })

function applyPreset(p: string) {
  filters.preset = p
  const now = new Date()
  if (p === 'all') { filters.from = ''; filters.to = '' }
  if (p === 'month') { filters.from = monthStartIso(now); filters.to = todayIso() }
  if (p === 'lastMonth') { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); filters.from = monthStartIso(d); const end = new Date(now.getFullYear(), now.getMonth(), 0); filters.to = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}` }
  if (p === 'year') { filters.from = `${now.getFullYear()}-01-01`; filters.to = todayIso() }
}

async function run() {
  loading.value = true
  error.value = null
  try {
    report.value = await api.call<Report>('reports.run', { type: filters.type, from: filters.from || undefined, to: filters.to || undefined, congregationId: filters.congregationId || undefined })
  } catch (err) {
    error.value = describeError(err)
  } finally {
    loading.value = false
  }
}

function exportCsv() {
  if (!report.value) return
  downloadCsv(`${report.value.type}_${filters.from || 'all'}_${filters.to || todayIso()}`, report.value.columns, report.value.rows)
}
function print() { window.print() }
function cell(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number') return formatNumber(v)
  return String(v)
}
</script>

<template>
  <div>
    <PageHeader title="Reports" subtitle="All figures come from the inventory ledger and transaction sheets." class="no-print">
      <AppButton variant="outline" size="sm" :disabled="!report?.rows.length" @click="exportCsv"><Download class="size-4" /> Export CSV</AppButton>
      <AppButton variant="outline" size="sm" :disabled="!report" @click="print"><Printer class="size-4" /> Print</AppButton>
    </PageHeader>

    <form class="card p-3 mb-5 grid gap-3 no-print lg:grid-cols-[1fr_1fr_auto]" @submit.prevent="run">
      <div class="grid gap-2 sm:grid-cols-2 lg:col-span-2">
        <label><span class="label">Report</span><select v-model="filters.type" class="input"><option v-for="t in types" :key="t.key" :value="t.key">{{ t.label }}</option></select></label>
        <label v-if="seesAll"><span class="label">Congregation</span><select v-model="filters.congregationId" class="input"><option value="">All</option><option v-for="c in reference.memberCongregations" :key="c.congregationId" :value="c.congregationId">{{ c.name }}</option></select></label>
        <div v-if="currentType?.dated" class="sm:col-span-2">
          <span class="label">Date range</span>
          <div class="flex flex-wrap gap-2 mb-2">
            <button v-for="p in [['all', 'All time'], ['month', 'This month'], ['lastMonth', 'Last month'], ['year', 'This year']]" :key="p[0]" type="button" :class="['rounded-full px-3 py-1 text-xs min-h-8', filters.preset === p[0] ? 'bg-brand-600 text-white' : 'bg-gray-100 text-ink hover:bg-gray-200']" @click="applyPreset(p[0])">{{ p[1] }}</button>
          </div>
          <DateRange v-model:from="filters.from" v-model:to="filters.to" class="max-w-md" @update:from="filters.preset = 'custom'" @update:to="filters.preset = 'custom'" />
        </div>
      </div>
      <div class="flex items-end"><AppButton type="submit" :loading="loading" block><Play class="size-4" /> Run report</AppButton></div>
    </form>

    <ErrorBanner :message="error" :retry="run" class="mb-4 no-print" />

    <section v-if="report" class="card overflow-hidden">
      <div class="px-4 py-3 border-b border-gray-100">
        <h2 class="font-semibold text-ink">{{ report.title }}</h2>
        <p class="text-xs text-muted">Generated {{ formatDateTime(report.generatedAt) }} by {{ report.generatedBy }}<template v-if="report.filters.from || report.filters.to"> · {{ report.filters.from || 'start' }} to {{ report.filters.to || 'today' }}</template><template v-if="report.filters.congregationId"> · {{ reference.congregationName(report.filters.congregationId) }}</template> · {{ formatNumber(report.rows.length) }} rows</p>
      </div>
      <EmptyState v-if="!report.rows.length" title="No data for this selection" class="py-10" />
      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm min-w-[640px]">
          <thead class="bg-gray-50/70"><tr><th v-for="c in report.columns" :key="c.key" class="table-head px-3 py-2 whitespace-nowrap">{{ c.label }}</th></tr></thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="(row, i) in report.rows" :key="i"><td v-for="c in report.columns" :key="c.key" :class="['px-3 py-1.5 whitespace-nowrap', typeof row[c.key] === 'number' ? 'text-right tabular-nums' : '']">{{ cell(row[c.key]) }}</td></tr>
          </tbody>
        </table>
      </div>
    </section>
    <div v-else-if="loading" class="card p-6 animate-pulse h-40" />
  </div>
</template>
