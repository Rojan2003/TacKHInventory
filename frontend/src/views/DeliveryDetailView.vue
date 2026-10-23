<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { CheckCircle2, Ban, Pencil, Printer } from 'lucide-vue-next'
import { api } from '@/services/api'
import { useMutation } from '@/composables/useAsync'
import { useApiQuery } from '@/composables/useApiQuery'
import { useConfirm } from '@/composables/useConfirm'
import { useAuthStore } from '@/stores/auth'
import { useReferenceStore } from '@/stores/reference'
import type { Delivery } from '@/types/api'
import { formatDate, formatDateTime, formatNumber } from '@/utils/format'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import DescriptionList from '@/components/ui/DescriptionList.vue'
import AppButton from '@/components/ui/AppButton.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'

const route = useRoute()
const auth = useAuthStore()
const reference = useReferenceStore()
const { confirm } = useConfirm()
const deliveryId = computed(() => String(route.params.deliveryId))
const { data: d, loading, error, reload, setData } = useApiQuery<Delivery>('deliveries.get', () => ({ deliveryId: deliveryId.value }))
const canManage = computed(() => auth.can('deliveries.manage'))

function print() { window.print() }

const confirmMutation = useMutation((requestId: string) => api.call<Delivery>('deliveries.confirm', { deliveryId: deliveryId.value }, { requestId }), { successTitle: 'Delivery confirmed and stock updated' })
const cancelMutation = useMutation((requestId: string, reason: string) => api.call<Delivery>('deliveries.cancel', { deliveryId: deliveryId.value, reason }, { requestId }), { successTitle: 'Delivery cancelled' })

async function onConfirm() {
  if (!d.value) return
  const r = await confirm({ title: `Confirm delivery ${d.value.reference}?`, message: `This will add ${formatNumber(d.value.totalQty)} units across ${d.value.itemCount} item(s) to East's physical stock. This cannot be undone; later corrections require a stock adjustment.`, confirmText: 'Confirm receipt' })
  if (!r.confirmed) return
  const res = await confirmMutation.mutate()
  if (res) { setData(res); reference.invalidate(['items']) }
}
async function onCancel() {
  if (!d.value) return
  const r = await confirm({ title: `Cancel delivery ${d.value.reference}?`, message: 'The delivery will be marked cancelled and will never be added to stock.', confirmText: 'Cancel delivery', danger: true, inputLabel: 'Reason', requireInput: true })
  if (!r.confirmed) return
  const res = await cancelMutation.mutate(r.input)
  if (res) setData(res)
}
</script>

<template>
  <div class="max-w-4xl">
    <PageHeader :title="d ? `Delivery ${d.reference}` : 'Delivery'" :subtitle="d ? `${d.sourceName} · ${formatDate(d.deliveryDate)}` : ''" :back-to="{ name: 'deliveries' }">
      <template v-if="d && canManage && d.status === 'Pending'">
        <AppButton variant="outline" :to="{ name: 'delivery-edit', params: { deliveryId } }"><Pencil class="size-4" /> Edit</AppButton>
        <AppButton variant="danger" :loading="cancelMutation.pending.value" @click="onCancel"><Ban class="size-4" /> Cancel</AppButton>
        <AppButton :loading="confirmMutation.pending.value" @click="onConfirm"><CheckCircle2 class="size-4" /> Confirm receipt</AppButton>
      </template>
      <AppButton variant="ghost" class="no-print" @click="print"><Printer class="size-4" /> Print</AppButton>
    </PageHeader>
    <ErrorBanner :message="error" :retry="reload" class="mb-4" />
    <div v-if="loading && !d" class="card p-6 animate-pulse h-48" />
    <template v-else-if="d">
      <section class="card p-4 sm:p-5 mb-5">
        <div class="flex items-center justify-between mb-4"><h2 class="font-semibold text-ink">Details</h2><StatusBadge :status="d.status" /></div>
        <DescriptionList :cols="3" :items="[
          { label: 'Reference', value: d.reference },
          { label: 'Delivery date', value: formatDate(d.deliveryDate) },
          { label: 'Source', value: `${d.sourceName} (${d.sourceType})` },
          { label: 'Received by', value: d.receivedBy },
          { label: 'Recorded', value: `${formatDateTime(d.createdAt)} by ${d.createdBy}` },
          { label: 'Confirmed', value: d.confirmedAt ? `${formatDateTime(d.confirmedAt)} by ${d.confirmedBy}` : (d.status === 'Pending' ? 'Not yet (stock unchanged)' : '—') },
          { label: 'Notes', value: d.notes },
        ]" />
        <p v-if="d.status === 'Confirmed' && d.ledgerPosted === false" class="mt-3 text-sm text-amber-700">Warning: this delivery is marked confirmed but no ledger entries were found. Run reconciliation from User Management → Maintenance.</p>
      </section>
      <section class="card overflow-hidden">
        <h2 class="font-semibold text-ink px-4 py-3 border-b border-gray-100">Literature ({{ d.itemCount }} lines · {{ formatNumber(d.totalQty) }} units)</h2>
        <table class="w-full text-sm">
          <thead class="bg-gray-50/70"><tr><th class="table-head px-4 py-2">Code</th><th class="table-head px-2 py-2">Literature</th><th class="table-head px-4 py-2 text-right">Quantity</th></tr></thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="l in (d.items || []).filter((x) => x.quantity > 0)" :key="l.itemId"><td class="px-4 py-2 font-mono text-xs">{{ l.sku }}</td><td class="px-2 py-2"><RouterLink :to="{ name: 'item-detail', params: { itemId: l.itemId } }" class="hover:underline">{{ l.itemName }}</RouterLink></td><td class="px-4 py-2 text-right tabular-nums font-medium">{{ formatNumber(l.quantity) }} <span class="text-xs text-muted">{{ l.unit }}</span></td></tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>
