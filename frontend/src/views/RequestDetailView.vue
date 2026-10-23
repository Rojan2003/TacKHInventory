<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { CheckCircle2, XCircle, Ban, Pencil, Send, Truck } from 'lucide-vue-next'
import { api } from '@/services/api'
import { useMutation } from '@/composables/useAsync'
import { useApiQuery } from '@/composables/useApiQuery'
import { useConfirm } from '@/composables/useConfirm'
import { useAuthStore } from '@/stores/auth'
import { useReferenceStore } from '@/stores/reference'
import type { LiteratureRequest } from '@/types/api'
import { formatDate, formatDateTime, formatNumber } from '@/utils/format'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import DescriptionList from '@/components/ui/DescriptionList.vue'
import AppButton from '@/components/ui/AppButton.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import Modal from '@/components/ui/Modal.vue'
import FormField from '@/components/ui/FormField.vue'

const route = useRoute()
const auth = useAuthStore()
const reference = useReferenceStore()
const { confirm } = useConfirm()
const requestId = computed(() => String(route.params.requestId))
const { data: r, loading, error, reload, setData } = useApiQuery<LiteratureRequest>('requests.get', () => ({ requestId: requestId.value }))
void reference.loadSettings()

const canDecide = computed(() => auth.can('requests.decide'))
const canDistribute = computed(() => auth.can('distributions.create'))
const isOwn = computed(() => !!r.value && r.value.congregationId === auth.user?.congregationId)
const canEdit = computed(() => !!r.value && ['Draft', 'Pending'].includes(r.value.status) && (canDecide.value || (auth.isCongregationUser && isOwn.value)))
const canSubmit = computed(() => !!r.value && r.value.status === 'Draft' && (canDecide.value || (auth.isCongregationUser && isOwn.value)))
const canCancel = computed(() => !!r.value && (canDecide.value ? !['Fulfilled', 'Rejected', 'Cancelled'].includes(r.value.status) : auth.isCongregationUser && isOwn.value && ['Draft', 'Pending'].includes(r.value.status)))
const canApprove = computed(() => canDecide.value && r.value?.status === 'Pending')
const canRelease = computed(() => canDistribute.value && !!r.value && ['Approved', 'Partially Fulfilled'].includes(r.value.status))
const lines = computed(() => (r.value?.items || []).filter((l) => l.requestedQty > 0))

const submitMutation = useMutation((rid: string) => api.call<LiteratureRequest>('requests.submit', { requestId: requestId.value }, { requestId: rid }), { successTitle: 'Request submitted' })
const rejectMutation = useMutation((rid: string, decisionNotes: string) => api.call<LiteratureRequest>('requests.reject', { requestId: requestId.value, decisionNotes }, { requestId: rid }), { successTitle: 'Request rejected' })
const cancelMutation = useMutation((rid: string, reason: string) => api.call<LiteratureRequest>('requests.cancel', { requestId: requestId.value, reason }, { requestId: rid }), { successTitle: 'Request cancelled' })
const approveMutation = useMutation((rid: string) => api.call<LiteratureRequest>('requests.approve', { requestId: requestId.value, decisionNotes: approve.notes, items: approve.lines.map((l) => ({ requestItemId: l.requestItemId, approvedQty: Number(l.approvedQty) || 0 })) }, { requestId: rid }), { successTitle: 'Request approved' })

async function onSubmit() { const res = await submitMutation.mutate(); if (res) setData(res) }
async function onReject() {
  const c = await confirm({ title: `Reject ${r.value?.requestNumber}?`, message: 'The requesting congregation will see the reason you give.', confirmText: 'Reject request', danger: true, inputLabel: 'Reason', requireInput: true })
  if (!c.confirmed) return
  const res = await rejectMutation.mutate(c.input); if (res) setData(res)
}
async function onCancel() {
  const releases = r.value && ['Approved', 'Partially Fulfilled'].includes(r.value.status) && reference.reserveOnApproval ? ' Reserved stock for the remaining quantity will be released.' : ''
  const c = await confirm({ title: `Cancel ${r.value?.requestNumber}?`, message: 'Cancelled requests cannot be reopened.' + releases, confirmText: 'Cancel request', danger: true, inputLabel: 'Reason (optional)' })
  if (!c.confirmed) return
  const res = await cancelMutation.mutate(c.input); if (res) { setData(res); reference.invalidate(['items']) }
}

/* ---- Approve dialog ---- */
const approve = reactive({ open: false, notes: '', lines: [] as { requestItemId: string; sku: string; itemName: string; requestedQty: number; availableQty: number; approvedQty: number | '' }[] })
const approveErrors = ref<Record<string, string>>({})
function openApprove() {
  approve.notes = ''
  approve.lines = lines.value.map((l) => ({ requestItemId: l.requestItemId, sku: l.sku, itemName: l.itemName, requestedQty: l.requestedQty, availableQty: l.availableQty ?? 0, approvedQty: Math.min(l.requestedQty, Math.max(0, l.availableQty ?? l.requestedQty)) }))
  approveErrors.value = {}
  approve.open = true
}
async function submitApprove() {
  const e: Record<string, string> = {}
  let total = 0
  approve.lines.forEach((l) => {
    const q = Number(l.approvedQty)
    if (l.approvedQty === '' || !Number.isInteger(q) || q < 0) e[l.requestItemId] = 'Enter a whole number of zero or more.'
    else if (q > l.requestedQty) e[l.requestItemId] = `Cannot exceed the requested ${l.requestedQty}.`
    else if (reference.reserveOnApproval && q > l.availableQty) e[l.requestItemId] = `Only ${l.availableQty} available.`
    total += q
  })
  if (!Object.keys(e).length && total <= 0) e.__all = 'Approve at least one unit, or reject the request instead.'
  approveErrors.value = e
  if (Object.keys(e).length) return
  const res = await approveMutation.mutate()
  if (res) { setData(res); approve.open = false; reference.invalidate(['items']) }
}
</script>

<template>
  <div class="max-w-5xl">
    <PageHeader :title="r ? `Request ${r.requestNumber}` : 'Request'" :subtitle="r ? `${r.congregationName} · ${formatDate(r.requestDate)}` : ''" :back-to="{ name: 'requests' }">
      <template v-if="r">
        <AppButton v-if="canEdit" variant="outline" :to="{ name: 'request-edit', params: { requestId } }"><Pencil class="size-4" /> Edit</AppButton>
        <AppButton v-if="canSubmit" :loading="submitMutation.pending.value" @click="onSubmit"><Send class="size-4" /> Submit</AppButton>
        <AppButton v-if="canCancel" variant="danger" :loading="cancelMutation.pending.value" @click="onCancel"><Ban class="size-4" /> Cancel request</AppButton>
        <AppButton v-if="canApprove" variant="outline" :loading="rejectMutation.pending.value" @click="onReject"><XCircle class="size-4" /> Reject</AppButton>
        <AppButton v-if="canApprove" @click="openApprove"><CheckCircle2 class="size-4" /> Approve…</AppButton>
        <AppButton v-if="canRelease" :to="{ name: 'distribution-new', query: { requestId } }"><Truck class="size-4" /> Release literature</AppButton>
      </template>
    </PageHeader>
    <ErrorBanner :message="error" :retry="reload" class="mb-4" />
    <div v-if="loading && !r" class="card p-6 animate-pulse h-48" />
    <template v-else-if="r">
      <div class="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section class="card p-4 sm:p-5 lg:col-span-1">
          <div class="flex items-center justify-between mb-4"><h2 class="font-semibold text-ink">Details</h2><StatusBadge :status="r.status" /></div>
          <DescriptionList :cols="1" :items="[
            { label: 'Congregation', value: r.congregationName },
            { label: 'Requested by', value: r.requestedBy },
            { label: 'Request date', value: formatDate(r.requestDate) },
            { label: 'Submitted', value: formatDateTime(r.submittedAt) },
            { label: r.status === 'Rejected' ? 'Rejected by' : 'Decided by', value: r.approvedBy ? `${r.approvedBy} · ${formatDateTime(r.decidedAt)}` : '' },
            { label: 'Decision notes', value: r.decisionNotes },
            { label: 'Notes', value: r.notes },
            { label: 'Created', value: `${formatDateTime(r.createdAt)} by ${r.createdBy}` },
          ]" />
        </section>
        <section class="card lg:col-span-2 overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
            <h2 class="font-semibold text-ink">Literature</h2>
            <p class="text-xs text-muted">Requested {{ formatNumber(r.requestedTotal) }} · Approved {{ formatNumber(r.approvedTotal) }} · Fulfilled {{ formatNumber(r.fulfilledTotal) }} · Remaining {{ formatNumber(r.remainingTotal) }}</p>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50/70"><tr><th class="table-head px-4 py-2">Item</th><th class="table-head px-2 py-2 text-right">Requested</th><th class="table-head px-2 py-2 text-right">Approved</th><th class="table-head px-2 py-2 text-right">Fulfilled</th><th class="table-head px-2 py-2 text-right">Remaining</th><th v-if="canDecide" class="table-head px-4 py-2 text-right">Available now</th></tr></thead>
              <tbody class="divide-y divide-gray-100">
                <tr v-for="l in lines" :key="l.requestItemId">
                  <td class="px-4 py-2"><RouterLink :to="{ name: 'item-detail', params: { itemId: l.itemId } }" class="font-medium text-ink hover:underline">{{ l.itemName }}</RouterLink><span class="block font-mono text-xs text-muted">{{ l.sku }}</span></td>
                  <td class="px-2 py-2 text-right tabular-nums">{{ formatNumber(l.requestedQty) }}</td>
                  <td class="px-2 py-2 text-right tabular-nums">{{ r.status === 'Draft' || r.status === 'Pending' ? '—' : formatNumber(l.approvedQty) }}</td>
                  <td class="px-2 py-2 text-right tabular-nums">{{ formatNumber(l.fulfilledQty) }}</td>
                  <td class="px-2 py-2 text-right tabular-nums font-medium">{{ r.status === 'Draft' || r.status === 'Pending' ? '—' : formatNumber(l.remainingQty) }}</td>
                  <td v-if="canDecide" class="px-4 py-2 text-right tabular-nums" :class="(l.availableQty ?? 0) < l.requestedQty ? 'text-amber-700' : 'text-muted'">{{ formatNumber(l.availableQty) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="r.distributions && r.distributions.length" class="border-t border-gray-100 px-4 py-3">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Distributions against this request</h3>
            <ul class="space-y-1 text-sm">
              <li v-for="d in r.distributions" :key="d.distributionId" class="flex items-center justify-between gap-2">
                <RouterLink :to="{ name: 'distribution-detail', params: { distributionId: d.distributionId } }" class="font-mono text-xs hover:underline">{{ d.reference }}</RouterLink>
                <span class="text-xs text-muted">{{ formatDateTime(d.createdAt) }} · {{ d.releasedBy }}</span>
                <StatusBadge :status="d.status" size="sm" />
              </li>
            </ul>
          </div>
        </section>
      </div>
    </template>

    <Modal :open="approve.open" title="Approve request" size="lg" @close="approve.open = false">
      <form id="approve-form" class="space-y-4" @submit.prevent="submitApprove">
        <p class="text-sm text-muted">Set the quantity approved for each line. <template v-if="reference.reserveOnApproval">Approved quantities are reserved from available stock until released.</template></p>
        <p v-if="approveErrors.__all" class="text-sm text-red-600" role="alert">{{ approveErrors.__all }}</p>
        <div class="space-y-2">
          <div v-for="l in approve.lines" :key="l.requestItemId" class="rounded-xl border border-gray-200 p-3 grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
            <div class="min-w-0"><p class="font-medium text-ink truncate">{{ l.itemName }}</p><p class="text-xs text-muted">{{ l.sku }} · requested {{ formatNumber(l.requestedQty) }} · available {{ formatNumber(l.availableQty) }}</p></div>
            <div class="sm:w-32"><label class="sr-only" :for="`ap-${l.requestItemId}`">Approved quantity</label><input :id="`ap-${l.requestItemId}`" v-model="l.approvedQty" type="number" min="0" :max="l.requestedQty" step="1" inputmode="numeric" class="input" :class="approveErrors[l.requestItemId] ? 'input-error' : ''" /></div>
            <p v-if="approveErrors[l.requestItemId]" class="text-xs text-red-600 sm:col-span-3" role="alert">{{ approveErrors[l.requestItemId] }}</p>
          </div>
        </div>
        <FormField label="Decision notes (optional)" for="ap-notes"><textarea id="ap-notes" v-model="approve.notes" class="input" rows="2" maxlength="1000" /></FormField>
      </form>
      <template #footer>
        <AppButton variant="outline" @click="approve.open = false">Cancel</AppButton>
        <AppButton type="submit" form="approve-form" :loading="approveMutation.pending.value">Approve request</AppButton>
      </template>
    </Modal>
  </div>
</template>
