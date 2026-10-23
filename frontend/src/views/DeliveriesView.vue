<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus, Eye, ClipboardPaste, AlertTriangle, CheckCircle2, Sparkles } from 'lucide-vue-next'
import { usePagedList } from '@/composables/usePagedList'
import { useMutation } from '@/composables/useAsync'
import { useConfirm } from '@/composables/useConfirm'
import { api, describeError } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { useReferenceStore } from '@/stores/reference'
import { useToastStore } from '@/stores/toast'
import type { Delivery, PackingListImportResult, PackingListPlanEntry } from '@/types/api'
import { formatDate, formatNumber } from '@/utils/format'
import PageHeader from '@/components/ui/PageHeader.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import DataTable, { type Column } from '@/components/ui/DataTable.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import AppButton from '@/components/ui/AppButton.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import DateRange from '@/components/ui/DateRange.vue'
import Modal from '@/components/ui/Modal.vue'
import FormField from '@/components/ui/FormField.vue'

const auth = useAuthStore()
const reference = useReferenceStore()
const toast = useToastStore()
const { confirm } = useConfirm()
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

/* ---------- Paste packing list ---------- */
const PLACEHOLDER = `Packing List  3770278
30 - g26.1-E | English - Awake!
150 - g26.1-TG | Tagalog - Awake!
2 - ldstd-2-E | Literature Display Stand - Double-sided`

const paste = reactive({ open: false, text: '', deliveryDate: new Date().toISOString().slice(0, 10), skipProblems: false })
const plan = ref<PackingListImportResult | null>(null)
const checking = ref(false)
const checkError = ref<string | null>(null)

function openPaste() { paste.open = true; paste.text = ''; paste.skipProblems = false; plan.value = null; checkError.value = null }

async function runCheck() {
  if (!paste.text.trim()) { checkError.value = 'Paste at least one packing list first.'; return }
  checking.value = true
  checkError.value = null
  plan.value = null
  try {
    plan.value = await api.call<PackingListImportResult>('deliveries.importPackingLists', { text: paste.text, deliveryDate: paste.deliveryDate, apply: false })
  } catch (err) {
    checkError.value = describeError(err)
  } finally {
    checking.value = false
  }
}

const okLists = computed(() => plan.value?.lists.filter((l) => l.status === 'ok') ?? [])
const problemLists = computed(() => plan.value?.lists.filter((l) => l.status !== 'ok') ?? [])
const hasProblems = computed(() => problemLists.value.length > 0 || (plan.value?.unparsed.length ?? 0) > 0)
const toCreateItems = computed(() => okLists.value.reduce((n, l) => n + l.lines.filter((x) => x.action === 'create').length, 0))
const canApply = computed(() => !!plan.value && okLists.value.length > 0 && (!hasProblems.value || paste.skipProblems))

const applyMutation = useMutation((rid: string) => api.call<PackingListImportResult>('deliveries.importPackingLists', { text: paste.text, deliveryDate: paste.deliveryDate, apply: true, skipProblems: paste.skipProblems }, { requestId: rid }))
async function runApply() {
  if (!canApply.value) return
  const n = okLists.value.length
  const c = await confirm({
    title: `Create ${n} deliver${n === 1 ? 'y' : 'ies'}?`,
    message: `${toCreateItems.value} new catalogue item${toCreateItems.value === 1 ? '' : 's'} will be created and ${n} pending deliver${n === 1 ? 'y' : 'ies'} from Branch Office dated ${formatDate(paste.deliveryDate)}. Stock is not posted until you confirm each delivery.${hasProblems.value ? ' Lists with problems are skipped.' : ''}`,
    confirmText: 'Create',
  })
  if (!c.confirmed) return
  const res = await applyMutation.mutate()
  if (!res) return
  toast.success(`${res.deliveriesCreated.length} deliver${res.deliveriesCreated.length === 1 ? 'y' : 'ies'} created`, res.itemsCreated.length ? `${res.itemsCreated.length} new item${res.itemsCreated.length === 1 ? '' : 's'}: ${res.itemsCreated.join(', ')}` : undefined)
  paste.open = false
  void list.reload()
  if (res.deliveriesCreated.length === 1) router.push({ name: 'delivery-detail', params: { deliveryId: res.deliveriesCreated[0].deliveryId } })
}

const ACTION_LABEL: Record<string, string> = { exists: 'Exists', existsInactive: 'Exists, inactive', create: 'Will be created' }
const STATUS_LABEL: Record<PackingListPlanEntry['status'], string> = { ok: 'Ready', duplicate: 'Already entered', empty: 'Empty', problems: 'Needs attention' }
</script>

<template>
  <div>
    <PageHeader title="Incoming Deliveries" subtitle="Only confirmed deliveries increase physical stock.">
      <AppButton v-if="canManage" variant="outline" @click="openPaste"><ClipboardPaste class="size-4" /> Paste packing list</AppButton>
      <AppButton v-if="canManage" :to="{ name: 'delivery-new' }"><Plus class="size-4" /> Record delivery</AppButton>
    </PageHeader>
    <ErrorBanner :message="list.error.value" :retry="list.reload" class="mb-4" />
    <div class="card overflow-hidden">
      <FilterBar v-model:query="list.params.query as string" placeholder="Search reference, packing list, source, receiver…" show-clear @clear="list.resetFilters()">
        <select v-model="list.params.status" class="input" aria-label="Status"><option value="">All statuses</option><option>Pending</option><option>Confirmed</option><option>Cancelled</option></select>
        <select v-model="list.params.sourceCongregationId" class="input" aria-label="Source congregation"><option value="">Any source</option><option v-for="c in reference.congregations" :key="c.congregationId" :value="c.congregationId">{{ c.name }}</option></select>
        <DateRange v-model:from="list.params.from as string" v-model:to="list.params.to as string" class="sm:col-span-2" />
      </FilterBar>
      <DataTable :columns="columns" :rows="list.page.value?.rows || []" row-key="deliveryId" :loading="list.loading.value" :sort-by="list.params.sortBy" :sort-dir="list.params.sortDir" clickable empty-title="No deliveries found" @sort="list.sort" @row-click="(r) => router.push({ name: 'delivery-detail', params: { deliveryId: r.deliveryId } })">
        <template #cell-reference="{ row }"><span class="font-mono text-xs font-medium">{{ row.reference }}</span><span v-if="row.packingListNumber" class="block text-[11px] text-muted">Packing list {{ row.packingListNumber }}</span></template>
        <template #cell-deliveryDate="{ row }">{{ formatDate(row.deliveryDate) }}</template>
        <template #cell-sourceName="{ row }">{{ row.sourceName }}<span class="block text-xs text-muted capitalize">{{ row.sourceType }}</span></template>
        <template #cell-totalQty="{ row }"><span class="tabular-nums font-medium">{{ formatNumber(row.totalQty) }}</span></template>
        <template #cell-status="{ row }"><StatusBadge :status="row.status" size="sm" /></template>
        <template #card="{ row }">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0"><p class="font-mono text-xs text-muted">{{ row.reference }}<span v-if="row.packingListNumber"> · PL {{ row.packingListNumber }}</span></p><p class="font-medium text-ink truncate">{{ row.sourceName }}</p><p class="text-xs text-muted">{{ formatDate(row.deliveryDate) }} · {{ row.itemCount }} lines · {{ formatNumber(row.totalQty) }} units</p></div>
            <StatusBadge :status="row.status" size="sm" />
          </div>
        </template>
        <template #actions="{ row }"><AppButton variant="ghost" size="sm" :to="{ name: 'delivery-detail', params: { deliveryId: row.deliveryId } }"><Eye class="size-4" /><span class="md:sr-only">View</span></AppButton></template>
      </DataTable>
      <Pagination v-if="list.page.value" :page="list.page.value.page" :total-pages="list.page.value.totalPages" :total="list.page.value.total" :page-size="list.page.value.pageSize" @update:page="(p) => (list.params.page = p)" @update:page-size="(s) => { list.params.pageSize = s; list.params.page = 1 }" />
    </div>

    <!-- Paste packing list -->
    <Modal :open="paste.open" title="Paste packing list" size="xl" @close="paste.open = false">
      <div class="space-y-4">
        <p class="text-sm text-muted">Paste one or more Watchtower packing lists exactly as received. Each list becomes a pending delivery from Branch Office; unknown symbols become new catalogue items. Check first, then create. Stock is posted only when you confirm each delivery.</p>
        <div class="grid gap-4 sm:grid-cols-[1fr_auto]">
          <FormField label="Packing list text" for="pl-text" required>
            <textarea id="pl-text" v-model="paste.text" class="input font-mono text-xs min-h-40" rows="8" :placeholder="PLACEHOLDER" spellcheck="false" :disabled="checking || applyMutation.pending.value" />
          </FormField>
          <FormField label="Delivery date" for="pl-date" required help="Applied to every list in this paste.">
            <input id="pl-date" v-model="paste.deliveryDate" type="date" class="input" :disabled="checking || applyMutation.pending.value" />
          </FormField>
        </div>
        <div v-if="checkError" class="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800 flex gap-2" role="alert"><AlertTriangle class="size-5 shrink-0" /><span>{{ checkError }}</span></div>

        <div v-if="plan" class="space-y-3" data-testid="packing-plan">
          <div v-if="plan.unparsed.length" class="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800">
            <p class="font-medium">Lines before any packing list number</p>
            <ul class="mt-1 list-disc pl-5 text-xs"><li v-for="(u, i) in plan.unparsed" :key="i"><span class="font-mono">{{ u.text }}</span> — {{ u.reason }}</li></ul>
          </div>
          <section v-for="l in plan.lists" :key="l.number" class="rounded-xl border p-3" :class="l.status === 'ok' ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/40'">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="font-medium text-ink flex items-center gap-2"><component :is="l.status === 'ok' ? CheckCircle2 : AlertTriangle" class="size-4" :class="l.status === 'ok' ? 'text-emerald-600' : 'text-amber-600'" /> Packing list {{ l.number }}</p>
              <span class="text-xs font-medium" :class="l.status === 'ok' ? 'text-emerald-700' : 'text-amber-700'">{{ STATUS_LABEL[l.status] }}<span v-if="l.reference"> · {{ l.reference }}</span></span>
            </div>
            <p v-if="l.problem" class="mt-1 text-xs text-amber-800">{{ l.problem }}</p>
            <div v-if="l.lines.length" class="mt-2 overflow-x-auto">
              <table class="w-full text-xs">
                <thead><tr class="text-left text-muted"><th class="py-1 pr-2 font-medium">Qty</th><th class="py-1 pr-2 font-medium">Symbol</th><th class="py-1 pr-2 font-medium">Language</th><th class="py-1 pr-2 font-medium">Title</th><th class="py-1 pr-2 font-medium">Category</th><th class="py-1 font-medium">Catalogue</th></tr></thead>
                <tbody class="divide-y divide-gray-100">
                  <tr v-for="x in l.lines" :key="x.symbol">
                    <td class="py-1 pr-2 tabular-nums font-medium">{{ formatNumber(x.quantity) }}</td>
                    <td class="py-1 pr-2 font-mono">{{ x.sku }}</td>
                    <td class="py-1 pr-2">{{ x.language || '—' }}</td>
                    <td class="py-1 pr-2">{{ x.name }}</td>
                    <td class="py-1 pr-2">{{ x.category || '—' }}</td>
                    <td class="py-1"><span :class="x.action === 'create' ? 'inline-flex items-center gap-1 text-brand-700' : x.action === 'exists' ? 'text-muted' : 'text-amber-700'"><Sparkles v-if="x.action === 'create'" class="size-3" />{{ ACTION_LABEL[x.action] }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ul v-if="l.unparsed.length" class="mt-2 list-disc pl-5 text-xs text-red-800"><li v-for="(u, i) in l.unparsed" :key="i"><span class="font-mono">{{ u.text }}</span> — {{ u.reason }}</li></ul>
            <ul v-if="l.notes.length" class="mt-2 list-disc pl-5 text-xs text-muted"><li v-for="(n, i) in l.notes" :key="i">{{ n }}</li></ul>
          </section>
          <label v-if="hasProblems && okLists.length" class="flex items-center gap-2 text-sm min-h-11"><input v-model="paste.skipProblems" type="checkbox" class="size-4 accent-brand-600" /> Skip lists with problems and create the others</label>
          <p v-if="!okLists.length" class="text-sm text-amber-800">Nothing can be created until the problems above are fixed.</p>
        </div>
      </div>
      <template #footer>
        <AppButton variant="outline" @click="paste.open = false">Cancel</AppButton>
        <AppButton variant="secondary" :loading="checking" :disabled="applyMutation.pending.value" @click="runCheck">Check</AppButton>
        <AppButton :disabled="!canApply" :loading="applyMutation.pending.value" @click="runApply">Create {{ okLists.length || '' }} deliver{{ okLists.length === 1 ? 'y' : 'ies' }}</AppButton>
      </template>
    </Modal>
  </div>
</template>
