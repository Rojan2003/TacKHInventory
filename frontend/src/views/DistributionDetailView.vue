<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { CheckCircle2, Printer } from 'lucide-vue-next'
import { api } from '@/services/api'
import { useAsync, useMutation } from '@/composables/useAsync'
import { useConfirm } from '@/composables/useConfirm'
import { useAuthStore } from '@/stores/auth'
import type { Distribution } from '@/types/api'
import { formatDateTime, formatNumber } from '@/utils/format'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import DescriptionList from '@/components/ui/DescriptionList.vue'
import AppButton from '@/components/ui/AppButton.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'

const route = useRoute()
const auth = useAuthStore()
const { confirm } = useConfirm()
const distributionId = computed(() => String(route.params.distributionId))
const { data: d, loading, error, reload } = useAsync<Distribution>(() => api.call('distributions.get', { distributionId: distributionId.value }))

const canConfirm = computed(() => !!d.value && d.value.status === 'Released' && auth.can('distributions.confirm') && (!auth.isCongregationUser || d.value.destinationCongregationId === auth.user?.congregationId))
const justCreated = computed(() => route.query.new === '1')

const confirmMutation = useMutation((rid: string, receivedBy: string) => api.call<Distribution>('distributions.confirmReceipt', { distributionId: distributionId.value, receivedBy }, { requestId: rid }), { successTitle: 'Receipt confirmed' })
async function onConfirm() {
  const c = await confirm({ title: `Confirm receipt of ${d.value?.reference}?`, message: `Confirm that ${d.value?.destinationName} has received ${formatNumber(d.value?.totalQty)} units.`, confirmText: 'Confirm received', inputLabel: 'Received by', inputPlaceholder: auth.user?.name || '' })
  if (!c.confirmed) return
  const res = await confirmMutation.mutate(c.input)
  if (res) d.value = res
}
function print() { window.print() }
</script>

<template>
  <div class="max-w-4xl">
    <PageHeader :title="d ? `Distribution ${d.reference}` : 'Distribution'" :subtitle="d ? `${d.destinationName} · ${formatDateTime(d.createdAt)}` : ''" :back-to="{ name: 'distributions' }" class="no-print">
      <AppButton v-if="canConfirm" :loading="confirmMutation.pending.value" @click="onConfirm"><CheckCircle2 class="size-4" /> Confirm receipt</AppButton>
      <AppButton variant="outline" @click="print"><Printer class="size-4" /> Print receipt</AppButton>
    </PageHeader>
    <ErrorBanner :message="error" :retry="reload" class="mb-4 no-print" />
    <div v-if="justCreated && d" class="no-print mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Literature released and stock updated. Print the receipt for the receiving congregation.</div>
    <div v-if="loading && !d" class="card p-6 animate-pulse h-48" />
    <template v-else-if="d">
      <section class="card p-4 sm:p-5 mb-5 no-print">
        <div class="flex items-center justify-between mb-4"><h2 class="font-semibold text-ink">Details</h2><StatusBadge :status="d.status" /></div>
        <DescriptionList :cols="3" :items="[
          { label: 'Reference', value: d.reference },
          { label: 'Request', value: d.requestNumber },
          { label: 'Destination', value: d.destinationName },
          { label: 'Released by', value: `${d.releasedBy} · ${formatDateTime(d.createdAt)}` },
          { label: 'Received by', value: d.receivedBy },
          { label: 'Receipt confirmed', value: d.receivedAt ? `${formatDateTime(d.receivedAt)} by ${d.receivedConfirmedBy}` : 'Not yet confirmed by the destination' },
          { label: 'Notes', value: d.notes },
          { label: 'Recorded by', value: d.createdBy },
        ]" />
        <p v-if="d.requestId" class="mt-3 text-sm"><RouterLink :to="{ name: 'request-detail', params: { requestId: d.requestId } }" class="text-brand-700 hover:underline">View request {{ d.requestNumber }}</RouterLink></p>
      </section>

      <!-- Printable receipt -->
      <section class="card p-5 sm:p-8 print:shadow-none print:border-0" aria-label="Distribution receipt">
        <div class="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 pb-4">
          <div>
            <p class="text-xs uppercase tracking-wider text-muted">{{ d.receipt?.appName }}</p>
            <h2 class="text-xl font-semibold text-ink">Distribution Receipt</h2>
            <p class="text-sm text-muted">Issued by {{ d.receipt?.issuedBy }}</p>
          </div>
          <div class="text-right text-sm">
            <p class="font-mono text-lg font-semibold">{{ d.reference }}</p>
            <p class="text-muted">{{ formatDateTime(d.createdAt) }}</p>
            <p class="mt-1"><StatusBadge :status="d.status" size="sm" /></p>
          </div>
        </div>
        <dl class="grid grid-cols-2 gap-3 py-4 text-sm sm:grid-cols-4">
          <div><dt class="text-xs text-muted">To</dt><dd class="font-medium">{{ d.destinationName }}</dd></div>
          <div><dt class="text-xs text-muted">Request</dt><dd class="font-medium">{{ d.requestNumber || '—' }}</dd></div>
          <div><dt class="text-xs text-muted">Released by</dt><dd class="font-medium">{{ d.releasedBy }}</dd></div>
          <div><dt class="text-xs text-muted">Received by</dt><dd class="font-medium">{{ d.receivedBy || '________________' }}</dd></div>
        </dl>
        <table class="w-full text-sm">
          <thead><tr class="border-y border-gray-200"><th class="table-head py-2 pr-2">Code</th><th class="table-head py-2 pr-2">Literature</th><th class="table-head py-2 text-right">Quantity</th></tr></thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="l in d.items || []" :key="l.distributionItemId"><td class="py-2 pr-2 font-mono text-xs">{{ l.sku }}</td><td class="py-2 pr-2">{{ l.itemName }}</td><td class="py-2 text-right tabular-nums">{{ formatNumber(l.quantity) }} {{ l.unit }}</td></tr>
          </tbody>
          <tfoot><tr class="border-t border-gray-200 font-semibold"><td colspan="2" class="py-2">Total</td><td class="py-2 text-right tabular-nums">{{ formatNumber(d.totalQty) }}</td></tr></tfoot>
        </table>
        <p v-if="d.notes" class="mt-4 text-sm text-muted">Notes: {{ d.notes }}</p>
        <div class="mt-8 grid grid-cols-2 gap-8 text-sm">
          <div><div class="border-t border-gray-400 pt-1">Released by (signature)</div></div>
          <div><div class="border-t border-gray-400 pt-1">Received by (signature / date)</div></div>
        </div>
      </section>
    </template>
  </div>
</template>
