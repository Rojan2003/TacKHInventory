<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus, Pencil, Eye } from 'lucide-vue-next'
import { api } from '@/services/api'
import { usePagedList } from '@/composables/usePagedList'
import { useMutation } from '@/composables/useAsync'
import { useAuthStore } from '@/stores/auth'
import { useReferenceStore } from '@/stores/reference'
import type { Item, ItemsPage } from '@/types/api'
import { formatDateTime, formatNumber } from '@/utils/format'
import PageHeader from '@/components/ui/PageHeader.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import DataTable, { type Column } from '@/components/ui/DataTable.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import AppButton from '@/components/ui/AppButton.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import Modal from '@/components/ui/Modal.vue'
import FormField from '@/components/ui/FormField.vue'

const auth = useAuthStore()
const reference = useReferenceStore()
const route = useRoute()
const router = useRouter()
const canManage = computed(() => auth.can('items.manage'))

const list = usePagedList<Item, ItemsPage>('items.list', {
  sortBy: 'name', sortDir: 'asc', category: '', lowStockOnly: route.query.lowStockOnly ? true : '', includeInactive: '',
})

const columns: Column[] = [
  { key: 'sku', label: 'Code', sortable: true, class: 'w-28' },
  { key: 'name', label: 'Literature', sortable: true },
  { key: 'category', label: 'Category', sortable: true, hideOnCard: true },
  { key: 'physicalQty', label: 'Physical', sortable: true, align: 'right' },
  { key: 'reservedQty', label: 'Reserved', sortable: true, align: 'right' },
  { key: 'availableQty', label: 'Available', sortable: true, align: 'right' },
  { key: 'status', label: 'Status', align: 'center' },
  { key: 'updatedAt', label: 'Updated', sortable: true, hideOnCard: true },
]

function stockStatus(i: Item) {
  if (!i.active) return 'Inactive'
  if (i.physicalQty <= 0) return 'Out of stock'
  if (i.isLowStock) return 'Low stock'
  return 'In stock'
}

/* ---- Add / edit dialog ---- */
const dialog = reactive({ open: false, editing: null as Item | null })
const form = reactive({ sku: '', name: '', description: '', category: '', unit: 'pcs', minStock: 10 as number | '', openingQty: '' as number | '', active: true })
const formErrors = ref<Record<string, string>>({})

function openCreate() {
  dialog.editing = null
  Object.assign(form, { sku: '', name: '', description: '', category: '', unit: 'pcs', minStock: 10, openingQty: '', active: true })
  formErrors.value = {}
  dialog.open = true
}
function openEdit(i: Item) {
  dialog.editing = i
  Object.assign(form, { sku: i.sku, name: i.name, description: i.description, category: i.category, unit: i.unit, minStock: i.minStock, openingQty: '', active: i.active })
  formErrors.value = {}
  dialog.open = true
}
function validate() {
  const e: Record<string, string> = {}
  if (!form.sku.trim()) e.sku = 'Item code is required.'
  if (!form.name.trim()) e.name = 'Literature name is required.'
  if (form.minStock !== '' && (Number(form.minStock) < 0 || !Number.isInteger(Number(form.minStock)))) e.minStock = 'Enter a whole number of zero or more.'
  if (form.openingQty !== '' && (Number(form.openingQty) < 0 || !Number.isInteger(Number(form.openingQty)))) e.openingQty = 'Enter a whole number of zero or more.'
  formErrors.value = e
  return Object.keys(e).length === 0
}
const save = useMutation(async (requestId: string) => {
  const params = { sku: form.sku, name: form.name, description: form.description, category: form.category, unit: form.unit, minStock: form.minStock === '' ? 0 : form.minStock }
  if (dialog.editing) return api.call<Item>('items.update', { ...params, itemId: dialog.editing.itemId, active: form.active }, { requestId })
  return api.call<Item>('items.create', { ...params, openingQty: form.openingQty === '' ? 0 : form.openingQty }, { requestId })
}, { successTitle: 'Item saved' })

async function submit() {
  if (!validate()) return
  const saved = await save.mutate()
  if (saved) { dialog.open = false; reference.invalidate(['items']); void list.reload() }
}

watch(() => route.query.lowStockOnly, (v) => { list.params.lowStockOnly = v ? true : '' })
</script>

<template>
  <div>
    <PageHeader title="Literature Inventory" subtitle="Physical stock is held by East Congregation. Available = physical − reserved.">
      <AppButton v-if="canManage" @click="openCreate"><Plus class="size-4" /> Add item</AppButton>
    </PageHeader>

    <ErrorBanner :message="list.error.value" :retry="list.reload" class="mb-4" />

    <div class="card overflow-hidden">
      <FilterBar v-model:query="list.params.query as string" placeholder="Search code, name, category…" show-clear @clear="list.resetFilters()">
        <select v-model="list.params.category" class="input" aria-label="Category">
          <option value="">All categories</option>
          <option v-for="c in list.page.value?.categories || []" :key="c" :value="c">{{ c }}</option>
        </select>
        <label class="flex items-center gap-2 text-sm min-h-11 px-1"><input v-model="list.params.lowStockOnly" type="checkbox" :true-value="true" false-value="" class="size-4 accent-brand-600" /> Low stock only</label>
        <label v-if="canManage" class="flex items-center gap-2 text-sm min-h-11 px-1"><input v-model="list.params.includeInactive" type="checkbox" :true-value="true" false-value="" class="size-4 accent-brand-600" /> Include inactive</label>
      </FilterBar>

      <DataTable :columns="columns" :rows="list.page.value?.rows || []" row-key="itemId" :loading="list.loading.value" :sort-by="list.params.sortBy" :sort-dir="list.params.sortDir" clickable empty-title="No literature items found" empty-message="Adjust the filters or add a new item." @sort="list.sort" @row-click="(r) => router.push({ name: 'item-detail', params: { itemId: r.itemId } })">
        <template #cell-sku="{ row }"><span class="font-mono text-xs">{{ row.sku }}</span></template>
        <template #cell-name="{ row }"><span class="font-medium text-ink">{{ row.name }}</span><span v-if="row.description" class="block text-xs text-muted truncate max-w-xs">{{ row.description }}</span></template>
        <template #cell-physicalQty="{ row }"><span class="tabular-nums">{{ formatNumber(row.physicalQty) }} <span class="text-xs text-muted">{{ row.unit }}</span></span></template>
        <template #cell-reservedQty="{ row }"><span class="tabular-nums text-muted">{{ formatNumber(row.reservedQty) }}</span></template>
        <template #cell-availableQty="{ row }"><span class="tabular-nums font-semibold" :class="row.availableQty <= 0 ? 'text-red-600' : ''">{{ formatNumber(row.availableQty) }}</span></template>
        <template #cell-status="{ row }"><StatusBadge :status="stockStatus(row)" size="sm" /></template>
        <template #cell-updatedAt="{ row }"><span class="text-xs text-muted">{{ formatDateTime(row.lastMovementAt || row.updatedAt) }}</span></template>
        <template #card="{ row }">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="font-medium text-ink truncate">{{ row.name }}</p>
              <p class="text-xs text-muted font-mono">{{ row.sku }}<span v-if="row.category"> · {{ row.category }}</span></p>
            </div>
            <StatusBadge :status="stockStatus(row)" size="sm" />
          </div>
          <dl class="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
            <div class="rounded-lg bg-gray-50 p-2"><dt class="text-muted">Physical</dt><dd class="font-semibold tabular-nums">{{ formatNumber(row.physicalQty) }}</dd></div>
            <div class="rounded-lg bg-gray-50 p-2"><dt class="text-muted">Reserved</dt><dd class="font-semibold tabular-nums">{{ formatNumber(row.reservedQty) }}</dd></div>
            <div class="rounded-lg bg-brand-50 p-2"><dt class="text-muted">Available</dt><dd class="font-semibold tabular-nums" :class="row.availableQty <= 0 ? 'text-red-600' : 'text-brand-800'">{{ formatNumber(row.availableQty) }}</dd></div>
          </dl>
        </template>
        <template #actions="{ row }">
          <AppButton variant="ghost" size="sm" :to="{ name: 'item-detail', params: { itemId: row.itemId } }" aria-label="View"><Eye class="size-4" /><span class="md:sr-only">View</span></AppButton>
          <AppButton v-if="canManage" variant="ghost" size="sm" aria-label="Edit" @click="openEdit(row)"><Pencil class="size-4" /><span class="md:sr-only">Edit</span></AppButton>
        </template>
      </DataTable>
      <Pagination v-if="list.page.value" :page="list.page.value.page" :total-pages="list.page.value.totalPages" :total="list.page.value.total" :page-size="list.page.value.pageSize" @update:page="(p) => (list.params.page = p)" @update:page-size="(s) => { list.params.pageSize = s; list.params.page = 1 }" />
    </div>

    <Modal :open="dialog.open" :title="dialog.editing ? 'Edit literature item' : 'Add literature item'" @close="dialog.open = false">
      <form id="item-form" class="grid gap-4 sm:grid-cols-2" @submit.prevent="submit">
        <FormField label="Item code / SKU" for="f-sku" required :error="formErrors.sku"><input id="f-sku" v-model="form.sku" class="input uppercase" :class="formErrors.sku ? 'input-error' : ''" maxlength="40" placeholder="LIT001" /></FormField>
        <FormField label="Unit of measurement" for="f-unit"><input id="f-unit" v-model="form.unit" class="input" maxlength="20" placeholder="pcs" /></FormField>
        <div class="sm:col-span-2"><FormField label="Literature name" for="f-name" required :error="formErrors.name"><input id="f-name" v-model="form.name" class="input" :class="formErrors.name ? 'input-error' : ''" maxlength="160" /></FormField></div>
        <div class="sm:col-span-2"><FormField label="Description" for="f-desc"><textarea id="f-desc" v-model="form.description" class="input" rows="2" maxlength="1000" /></FormField></div>
        <FormField label="Category" for="f-cat"><input id="f-cat" v-model="form.category" class="input" maxlength="60" list="category-list" placeholder="Magazines, Books…" /><datalist id="category-list"><option v-for="c in list.page.value?.categories || []" :key="c" :value="c" /></datalist></FormField>
        <FormField label="Minimum stock threshold" for="f-min" :error="formErrors.minStock" help="Low-stock alert when physical stock falls to this level."><input id="f-min" v-model="form.minStock" type="number" min="0" step="1" inputmode="numeric" class="input" /></FormField>
        <FormField v-if="!dialog.editing" label="Opening quantity" for="f-open" :error="formErrors.openingQty" help="Posted to the ledger as an opening balance."><input id="f-open" v-model="form.openingQty" type="number" min="0" step="1" inputmode="numeric" class="input" placeholder="0" /></FormField>
        <label v-else class="flex items-center gap-2 text-sm min-h-11 sm:mt-6"><input v-model="form.active" type="checkbox" class="size-4 accent-brand-600" /> Active (inactive items are hidden from pickers)</label>
      </form>
      <template #footer>
        <AppButton variant="outline" @click="dialog.open = false">Cancel</AppButton>
        <AppButton type="submit" form="item-form" :loading="save.pending.value">{{ dialog.editing ? 'Save changes' : 'Create item' }}</AppButton>
      </template>
    </Modal>
  </div>
</template>
