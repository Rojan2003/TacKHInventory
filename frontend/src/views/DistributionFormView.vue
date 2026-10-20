<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, describeError } from '@/services/api'
import { useMutation } from '@/composables/useAsync'
import { useConfirm } from '@/composables/useConfirm'
import { useReferenceStore } from '@/stores/reference'
import { useAuthStore } from '@/stores/auth'
import type { Distribution, LiteratureRequest, Paged } from '@/types/api'
import { formatDate, formatNumber } from '@/utils/format'
import PageHeader from '@/components/ui/PageHeader.vue'
import FormField from '@/components/ui/FormField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import LineItemsEditor, { type LineDraft } from '@/components/forms/LineItemsEditor.vue'

const route = useRoute()
const router = useRouter()
const reference = useReferenceStore()
const auth = useAuthStore()
const { confirm } = useConfirm()

const mode = ref<'request' | 'adhoc'>('request')
const openRequests = ref<LiteratureRequest[]>([])
const selectedRequestId = ref((route.query.requestId as string) || '')
const request = ref<LiteratureRequest | null>(null)
const loadingRequests = ref(true)
const loadingRequest = ref(false)
const loadError = ref<string | null>(null)

const form = reactive({ destinationCongregationId: '', releasedBy: auth.user?.name || '', receivedBy: '', notes: '' })
const lines = ref<LineDraft[]>([])
const errors = ref<Record<string, string>>({})
const lineErrors = ref<Record<number, string>>({})

onMounted(async () => {
  await Promise.all([reference.loadCongregations(), reference.loadSettings()])
  try {
    const page = await api.call<Paged<LiteratureRequest>>('requests.list', { statuses: ['Approved', 'Partially Fulfilled'], pageSize: 200, sortBy: 'requestDate', sortDir: 'asc' })
    openRequests.value = page.rows
  } catch (err) {
    loadError.value = describeError(err)
  } finally {
    loadingRequests.value = false
  }
  if (selectedRequestId.value) await loadRequest(selectedRequestId.value)
})

watch(selectedRequestId, (id) => void loadRequest(id))

async function loadRequest(id: string) {
  request.value = null
  lines.value = []
  if (!id) return
  loadingRequest.value = true
  try {
    const r = await api.call<LiteratureRequest>('requests.get', { requestId: id })
    request.value = r
    form.destinationCongregationId = r.congregationId
    lines.value = (r.items || []).filter((l) => l.remainingQty > 0).map((l, i) => ({ key: i + 1, itemId: l.itemId, quantity: Math.max(0, Math.min(l.remainingQty, l.physicalQty ?? l.remainingQty)) || '' }))
  } catch (err) {
    loadError.value = describeError(err)
  } finally {
    loadingRequest.value = false
  }
}

const allowedItems = computed(() => (request.value?.items || []).filter((l) => l.remainingQty > 0).map((l) => ({ itemId: l.itemId, max: l.remainingQty, hint: `Approved ${formatNumber(l.approvedQty)} · fulfilled ${formatNumber(l.fulfilledQty)} · remaining ${formatNumber(l.remainingQty)} · physical ${formatNumber(l.physicalQty)} · available ${formatNumber(l.availableQty)}` })))
const destinationName = computed(() => reference.congregationName(form.destinationCongregationId))

function validate() {
  const e: Record<string, string> = {}
  const le: Record<number, string> = {}
  if (mode.value === 'request' && !request.value) e.request = 'Select an approved request.'
  if (mode.value === 'adhoc' && !form.destinationCongregationId) e.destination = 'Select the destination congregation.'
  if (!form.releasedBy.trim()) e.releasedBy = 'Releasing person is required.'
  if (!lines.value.length) e.lines = 'Add at least one literature item.'
  const reqLines = Object.fromEntries((request.value?.items || []).map((l) => [l.itemId, l]))
  lines.value.forEach((l, i) => {
    if (!l.itemId) { le[i] = 'Select an item.'; return }
    const q = Number(l.quantity)
    if (l.quantity === '' || q <= 0 || !Number.isInteger(q)) { le[i] = 'Quantity must be a positive whole number.'; return }
    if (mode.value === 'request') {
      const rl = reqLines[l.itemId]
      if (!rl) le[i] = 'This item is not on the request.'
      else if (q > rl.remainingQty) le[i] = `Only ${rl.remainingQty} remaining to fulfil.`
      else if (rl.physicalQty !== undefined && q > rl.physicalQty) le[i] = `Only ${rl.physicalQty} physically in stock.`
    } else {
      const item = reference.items.find((x) => x.itemId === l.itemId)
      if (item && q > item.availableQty) le[i] = `Only ${item.availableQty} available.`
    }
  })
  errors.value = e
  lineErrors.value = le
  return !Object.keys(e).length && !Object.keys(le).length
}

const release = useMutation((rid: string) => api.call<Distribution>('distributions.create', {
  requestId: mode.value === 'request' ? request.value?.requestId : undefined,
  destinationCongregationId: mode.value === 'adhoc' ? form.destinationCongregationId : undefined,
  releasedBy: form.releasedBy, receivedBy: form.receivedBy, notes: form.notes,
  items: lines.value.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity) })),
}, { requestId: rid }), { successTitle: 'Literature released' })

const total = computed(() => lines.value.reduce((s, l) => s + (Number(l.quantity) || 0), 0))

async function submit() {
  if (!validate()) return
  const c = await confirm({ title: 'Release literature?', message: `${formatNumber(total.value)} units will be deducted from East's physical stock and recorded as released to ${destinationName.value}.${request.value ? ` Request ${request.value.requestNumber} will be updated.` : ''}`, confirmText: 'Release' })
  if (!c.confirmed) return
  const d = await release.mutate()
  if (d) { reference.invalidate(['items']); router.push({ name: 'distribution-detail', params: { distributionId: d.distributionId }, query: { new: '1' } }) }
}
</script>

<template>
  <div class="max-w-3xl">
    <PageHeader title="Release literature" subtitle="Record a distribution from East to a congregation." :back-to="{ name: 'distributions' }" />
    <ErrorBanner :message="loadError" class="mb-4" />
    <form class="space-y-5" novalidate @submit.prevent="submit">
      <section class="card p-4 sm:p-5 space-y-4">
        <h2 class="font-semibold text-ink">1. What is being fulfilled?</h2>
        <div v-if="reference.allowAdHocDistribution" class="flex gap-2 text-sm">
          <label class="flex items-center gap-2"><input v-model="mode" type="radio" value="request" class="accent-brand-600" /> Approved request</label>
          <label class="flex items-center gap-2"><input v-model="mode" type="radio" value="adhoc" class="accent-brand-600" /> Without a request</label>
        </div>
        <FormField v-if="mode === 'request'" label="Approved request" for="dist-req" required :error="errors.request">
          <select id="dist-req" v-model="selectedRequestId" class="input" :disabled="loadingRequests">
            <option value="" disabled>{{ loadingRequests ? 'Loading…' : openRequests.length ? 'Select a request…' : 'No approved requests awaiting release' }}</option>
            <option v-for="r in openRequests" :key="r.requestId" :value="r.requestId">{{ r.requestNumber }} — {{ r.congregationName }} ({{ r.status }}, {{ formatNumber(r.remainingTotal) }} remaining)</option>
          </select>
        </FormField>
        <FormField v-else label="Destination congregation" for="dist-dest" required :error="errors.destination">
          <select id="dist-dest" v-model="form.destinationCongregationId" class="input"><option value="" disabled>Select…</option><option v-for="c in reference.memberCongregations" :key="c.congregationId" :value="c.congregationId">{{ c.name }}</option></select>
        </FormField>
        <div v-if="request" class="rounded-xl bg-brand-50 p-3 text-sm">
          <div class="flex flex-wrap items-center justify-between gap-2"><p><span class="font-medium text-ink">{{ request.requestNumber }}</span> · {{ request.congregationName }} · {{ formatDate(request.requestDate) }}</p><StatusBadge :status="request.status" size="sm" /></div>
          <p class="text-xs text-muted mt-1">Approved {{ formatNumber(request.approvedTotal) }} · fulfilled {{ formatNumber(request.fulfilledTotal) }} · remaining {{ formatNumber(request.remainingTotal) }}<span v-if="request.notes"> · “{{ request.notes }}”</span></p>
        </div>
        <div v-else-if="loadingRequest" class="h-14 animate-pulse rounded-xl bg-gray-100" />
      </section>

      <section class="card p-4 sm:p-5">
        <h2 class="font-semibold text-ink mb-1">2. Quantities to release</h2>
        <p class="text-xs text-muted mb-3">Pre-filled with the remaining approved quantity, capped by physical stock. The server re-validates every line.</p>
        <p v-if="errors.lines" class="text-sm text-red-600 mb-2" role="alert">{{ errors.lines }}</p>
        <LineItemsEditor v-model="lines" :errors="lineErrors" :allowed-items="mode === 'request' ? allowedItems : undefined" :disabled="mode === 'request' && !request" quantity-label="Release qty" />
      </section>

      <section class="card p-4 sm:p-5 grid gap-4 sm:grid-cols-2">
        <h2 class="sm:col-span-2 font-semibold text-ink">3. Personnel and notes</h2>
        <FormField label="Released by" for="dist-rel" required :error="errors.releasedBy"><input id="dist-rel" v-model="form.releasedBy" class="input" maxlength="120" /></FormField>
        <FormField label="Received by (if known)" for="dist-recv" help="The destination congregation can confirm receipt later."><input id="dist-recv" v-model="form.receivedBy" class="input" maxlength="120" /></FormField>
        <div class="sm:col-span-2"><FormField label="Notes" for="dist-notes"><textarea id="dist-notes" v-model="form.notes" class="input" rows="2" maxlength="1000" /></FormField></div>
      </section>

      <div class="sticky bottom-0 -mx-4 lg:mx-0 bg-surface/95 backdrop-blur px-4 py-3 lg:px-0 flex items-center justify-between gap-2 border-t border-brand-100 lg:border-0">
        <p class="text-sm text-muted">Releasing <span class="font-semibold text-ink tabular-nums">{{ formatNumber(total) }}</span> units<span v-if="destinationName"> to {{ destinationName }}</span></p>
        <div class="flex gap-2"><AppButton variant="outline" :to="{ name: 'distributions' }">Cancel</AppButton><AppButton type="submit" :loading="release.pending.value" :disabled="mode === 'request' && !request">Release and print receipt</AppButton></div>
      </div>
    </form>
  </div>
</template>
