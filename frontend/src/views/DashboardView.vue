<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { Boxes, Package, Layers, Lock, Truck, ClipboardList, Send, AlertTriangle, RefreshCw, History } from 'lucide-vue-next'
import { api } from '@/services/api'
import { useAsync } from '@/composables/useAsync'
import { useAuthStore } from '@/stores/auth'
import { useReferenceStore } from '@/stores/reference'
import type { DashboardSummary } from '@/types/api'
import { formatDateTime, formatNumber, signed, TXN_TYPE_LABELS } from '@/utils/format'
import StatCard from '@/components/ui/StatCard.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import DateRange from '@/components/ui/DateRange.vue'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const auth = useAuthStore()
const reference = useReferenceStore()
const filters = reactive({ from: '', to: '', congregationId: '' })

const { data, loading, error, reload } = useAsync<DashboardSummary>(() =>
  api.call('dashboard.summary', { from: filters.from || undefined, to: filters.to || undefined, congregationId: filters.congregationId || undefined }),
)
watch(filters, () => void reload())
void reference.loadCongregations()

const isCong = computed(() => auth.isCongregationUser)
const requestTotal = computed(() => {
  const r = data.value?.requests
  return r ? r.draft + r.pending + r.approved + r.partiallyFulfilled + r.fulfilled + r.rejected + r.cancelled : 0
})
const periodLabel = computed(() => (filters.from || filters.to ? `${filters.from || 'start'} to ${filters.to || 'today'}` : 'all time'))

function clearFilters() { filters.from = ''; filters.to = ''; filters.congregationId = '' }
</script>

<template>
  <div>
    <PageHeader title="Dashboard" :subtitle="`Live figures from the inventory ledger · ${periodLabel}`">
      <AppButton variant="outline" size="sm" :loading="loading" @click="reload()"><RefreshCw class="size-4" /> Refresh</AppButton>
    </PageHeader>

    <div class="card p-3 mb-5 grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
      <DateRange v-model:from="filters.from" v-model:to="filters.to" />
      <select v-if="!isCong" v-model="filters.congregationId" class="input sm:w-56" aria-label="Congregation filter">
        <option value="">All congregations</option>
        <option v-for="c in reference.memberCongregations" :key="c.congregationId" :value="c.congregationId">{{ c.name }}</option>
      </select>
      <AppButton variant="ghost" size="sm" @click="clearFilters">Clear</AppButton>
    </div>

    <ErrorBanner :message="error" :retry="reload" class="mb-5" />

    <!-- Stock cards -->
    <section v-if="!isCong" aria-labelledby="stock-heading" class="mb-6">
      <h2 id="stock-heading" class="text-sm font-semibold text-muted uppercase tracking-wide mb-2">Stock held by {{ data?.coordinator.name || 'East Congregation' }}</h2>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Unique items" :value="data?.stock.uniqueItems" :icon="Boxes" tone="brand" :loading="loading && !data" :to="{ name: 'inventory' }" />
        <StatCard label="Physical stock" :value="data?.stock.physicalQty" hint="Units on hand" :icon="Package" tone="brand" :loading="loading && !data" />
        <StatCard label="Reserved" :value="data?.stock.reservedQty" :hint="data?.reserveOnApproval ? 'Approved, not yet released' : 'Reservation is off'" :icon="Lock" tone="info" :loading="loading && !data" />
        <StatCard label="Available" :value="data?.stock.availableQty" hint="Physical minus reserved" :icon="Layers" tone="brand" :loading="loading && !data" />
      </div>
    </section>

    <!-- Activity cards -->
    <section aria-labelledby="activity-heading" class="mb-6">
      <h2 id="activity-heading" class="text-sm font-semibold text-muted uppercase tracking-wide mb-2">Activity</h2>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard v-if="!isCong" label="Incoming deliveries" :value="data?.deliveries.pending" hint="Pending confirmation" :icon="Truck" tone="warning" :loading="loading && !data" :to="{ name: 'deliveries', query: { status: 'Pending' } }" />
        <StatCard label="Pending requests" :value="data?.requests.pending" hint="Awaiting a decision" :icon="ClipboardList" tone="warning" :loading="loading && !data" :to="{ name: 'requests', query: { status: 'Pending' } }" />
        <StatCard label="Approved, awaiting release" :value="data?.requests.awaitingFulfilment" hint="Approved + partially fulfilled" :icon="ClipboardList" tone="info" :loading="loading && !data" :to="{ name: 'requests', query: { status: 'Approved' } }" />
        <StatCard label="Completed distributions" :value="data ? data.distributions.released + data.distributions.received : undefined" :hint="data ? `${formatNumber(data.distributions.totalQty)} units · ${data.distributions.received} confirmed received` : ''" :icon="Send" tone="brand" :loading="loading && !data" :to="{ name: 'distributions' }" />
        <StatCard v-if="isCong" label="Fulfilled requests" :value="data?.requests.fulfilled" :hint="`of ${requestTotal} total`" :icon="ClipboardList" tone="brand" :loading="loading && !data" />
      </div>
    </section>

    <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <!-- Low stock -->
      <section v-if="!isCong" class="card" aria-labelledby="low-heading">
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 id="low-heading" class="font-semibold text-ink flex items-center gap-2"><AlertTriangle class="size-4 text-amber-600" /> Low-stock items <span v-if="data" class="text-xs text-muted font-normal">({{ data.stock.lowStockCount }})</span></h2>
          <RouterLink :to="{ name: 'inventory', query: { lowStockOnly: '1' } }" class="text-xs text-brand-700 hover:underline">View all</RouterLink>
        </div>
        <EmptyState v-if="data && !data.stock.lowStockItems.length" title="No low-stock items" message="All active items are above their minimum stock level." class="py-8" />
        <ul v-else class="divide-y divide-gray-100">
          <li v-for="i in data?.stock.lowStockItems || []" :key="i.itemId" class="flex items-center justify-between px-4 py-2.5 text-sm">
            <RouterLink :to="{ name: 'item-detail', params: { itemId: i.itemId } }" class="min-w-0 hover:underline">
              <span class="font-medium text-ink">{{ i.name }}</span> <span class="text-xs text-muted">{{ i.sku }}</span>
            </RouterLink>
            <span class="tabular-nums"><span :class="i.physicalQty === 0 ? 'text-red-600 font-semibold' : 'text-amber-700 font-medium'">{{ formatNumber(i.physicalQty) }}</span> <span class="text-xs text-muted">/ min {{ i.minStock }}</span></span>
          </li>
        </ul>
      </section>

      <!-- Distribution by congregation -->
      <section class="card" aria-labelledby="cong-heading">
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 id="cong-heading" class="font-semibold text-ink">Distribution summary by congregation</h2>
          <RouterLink :to="{ name: 'congregation-stock' }" class="text-xs text-brand-700 hover:underline">Details</RouterLink>
        </div>
        <EmptyState v-if="data && !data.distributionByCongregation.length" title="No distributions yet" class="py-8" />
        <div v-else class="overflow-x-auto"><table class="w-full text-sm">
          <thead><tr class="border-b border-gray-100"><th class="table-head px-4 py-2">Congregation</th><th class="table-head px-2 py-2 text-right">Releases</th><th class="table-head px-2 py-2 text-right">Units released</th><th class="table-head px-4 py-2 text-right">Confirmed received</th></tr></thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="c in data?.distributionByCongregation || []" :key="c.congregationId">
              <td class="px-4 py-2 text-ink">{{ c.name }}</td>
              <td class="px-2 py-2 text-right tabular-nums">{{ formatNumber(c.distributions) }}</td>
              <td class="px-2 py-2 text-right tabular-nums">{{ formatNumber(c.releasedQty) }}</td>
              <td class="px-4 py-2 text-right tabular-nums">{{ formatNumber(c.receivedQty) }}</td>
            </tr>
          </tbody>
        </table></div>
        <p class="px-4 py-2 text-xs text-muted border-t border-gray-100">Units released are deducted from East's physical stock once. Confirmed received is reported by the destination congregation.</p>
      </section>

      <!-- Recent transactions -->
      <section v-if="!isCong" class="card lg:col-span-2" aria-labelledby="recent-heading">
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 id="recent-heading" class="font-semibold text-ink flex items-center gap-2"><History class="size-4 text-brand-600" /> Recent inventory transactions</h2>
          <RouterLink :to="{ name: 'reports', query: { type: 'transactions' } }" class="text-xs text-brand-700 hover:underline">Full ledger</RouterLink>
        </div>
        <EmptyState v-if="data && !data.recentTransactions.length" title="No transactions in this period" class="py-8" />
        <ul v-else class="divide-y divide-gray-100">
          <li v-for="t in data?.recentTransactions || []" :key="t.txnId" class="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span :class="['w-16 shrink-0 text-right font-semibold tabular-nums', t.quantity < 0 ? 'text-red-600' : 'text-emerald-700']">{{ signed(t.quantity) }}</span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-ink"><span class="font-medium">{{ t.itemName }}</span> <span class="text-xs text-muted">{{ t.sku }}</span></p>
              <p class="truncate text-xs text-muted">{{ TXN_TYPE_LABELS[t.type] || t.type }}<span v-if="t.counterpartyName"> · {{ t.counterpartyName }}</span> · {{ t.actor }}</p>
            </div>
            <span class="hidden sm:block shrink-0 text-xs text-muted">{{ formatDateTime(t.timestamp) }}</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
