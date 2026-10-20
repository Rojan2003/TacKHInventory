<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/services/api'
import { useMutation } from '@/composables/useAsync'
import { useReferenceStore } from '@/stores/reference'
import { useAuthStore } from '@/stores/auth'
import type { Delivery } from '@/types/api'
import { todayIso } from '@/utils/format'
import PageHeader from '@/components/ui/PageHeader.vue'
import FormField from '@/components/ui/FormField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import LineItemsEditor, { type LineDraft } from '@/components/forms/LineItemsEditor.vue'

const route = useRoute()
const router = useRouter()
const reference = useReferenceStore()
const auth = useAuthStore()
const deliveryId = computed(() => (route.params.deliveryId ? String(route.params.deliveryId) : ''))
const isEdit = computed(() => !!deliveryId.value)

const form = reactive({ deliveryDate: todayIso(), sourceType: 'supplier' as 'supplier' | 'congregation', sourceCongregationId: '', sourceName: '', receivedBy: auth.user?.name || '', notes: '', confirmNow: false })
const lines = ref<LineDraft[]>([{ key: 1, itemId: '', quantity: '' }])
const errors = ref<Record<string, string>>({})
const lineErrors = ref<Record<number, string>>({})
const loadError = ref<string | null>(null)
const loading = ref(isEdit.value)

onMounted(async () => {
  await reference.loadCongregations()
  if (!isEdit.value) return
  try {
    const d = await api.call<Delivery>('deliveries.get', { deliveryId: deliveryId.value })
    if (d.status !== 'Pending') { router.replace({ name: 'delivery-detail', params: { deliveryId: d.deliveryId } }); return }
    Object.assign(form, { deliveryDate: d.deliveryDate, sourceType: d.sourceType, sourceCongregationId: d.sourceCongregationId, sourceName: d.sourceType === 'supplier' ? d.sourceName : '', receivedBy: d.receivedBy, notes: d.notes })
    lines.value = (d.items || []).filter((l) => l.quantity > 0).map((l, i) => ({ key: i + 1, itemId: l.itemId, quantity: l.quantity }))
  } catch (err) {
    loadError.value = (err as Error).message
  } finally {
    loading.value = false
  }
})

function validate() {
  const e: Record<string, string> = {}
  const le: Record<number, string> = {}
  if (!form.deliveryDate) e.deliveryDate = 'Delivery date is required.'
  if (form.deliveryDate > todayIso()) e.deliveryDate = 'Delivery date cannot be in the future.'
  if (form.sourceType === 'supplier' && !form.sourceName.trim()) e.sourceName = 'Supplier name is required.'
  if (form.sourceType === 'congregation' && !form.sourceCongregationId) e.sourceCongregationId = 'Select the source congregation.'
  if (!form.receivedBy.trim()) e.receivedBy = 'Receiving person is required.'
  if (!lines.value.length) e.lines = 'Add at least one literature item.'
  lines.value.forEach((l, i) => {
    if (!l.itemId) le[i] = 'Select an item.'
    else if (l.quantity === '' || Number(l.quantity) <= 0 || !Number.isInteger(Number(l.quantity))) le[i] = 'Quantity must be a positive whole number.'
  })
  errors.value = e
  lineErrors.value = le
  return !Object.keys(e).length && !Object.keys(le).length
}

const save = useMutation(async (requestId: string) => {
  const params = { ...form, items: lines.value.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity) })) }
  if (isEdit.value) return api.call<Delivery>('deliveries.update', { ...params, deliveryId: deliveryId.value }, { requestId })
  return api.call<Delivery>('deliveries.create', params, { requestId })
}, { successTitle: 'Delivery saved' })

async function submit() {
  if (!validate()) return
  const d = await save.mutate()
  if (d) { reference.invalidate(['items']); router.push({ name: 'delivery-detail', params: { deliveryId: d.deliveryId } }) }
}
</script>

<template>
  <div class="max-w-3xl">
    <PageHeader :title="isEdit ? 'Edit pending delivery' : 'Record incoming delivery'" subtitle="Stock increases only when the delivery is confirmed." :back-to="isEdit ? { name: 'delivery-detail', params: { deliveryId } } : { name: 'deliveries' }" />
    <ErrorBanner :message="loadError" class="mb-4" />
    <form v-if="!loading" class="space-y-5" novalidate @submit.prevent="submit">
      <section class="card p-4 sm:p-5 grid gap-4 sm:grid-cols-2">
        <h2 class="sm:col-span-2 font-semibold text-ink">Delivery details</h2>
        <FormField label="Delivery date" for="d-date" required :error="errors.deliveryDate"><input id="d-date" v-model="form.deliveryDate" type="date" class="input" :max="todayIso()" /></FormField>
        <FormField label="Source type" for="d-type"><select id="d-type" v-model="form.sourceType" class="input"><option value="supplier">Supplier / branch</option><option value="congregation">Another congregation</option></select></FormField>
        <FormField v-if="form.sourceType === 'supplier'" label="Supplier name" for="d-src" required :error="errors.sourceName"><input id="d-src" v-model="form.sourceName" class="input" maxlength="160" placeholder="Branch Office" /></FormField>
        <FormField v-else label="Source congregation" for="d-cong" required :error="errors.sourceCongregationId">
          <select id="d-cong" v-model="form.sourceCongregationId" class="input"><option value="" disabled>Select…</option><option v-for="c in reference.congregations.filter((x) => x.active && x.type !== 'coordinator')" :key="c.congregationId" :value="c.congregationId">{{ c.name }}</option></select>
        </FormField>
        <FormField label="Received by" for="d-recv" required :error="errors.receivedBy"><input id="d-recv" v-model="form.receivedBy" class="input" maxlength="120" /></FormField>
        <div class="sm:col-span-2"><FormField label="Notes" for="d-notes"><textarea id="d-notes" v-model="form.notes" class="input" rows="2" maxlength="1000" /></FormField></div>
      </section>

      <section class="card p-4 sm:p-5">
        <h2 class="font-semibold text-ink mb-3">Literature received</h2>
        <p v-if="errors.lines" class="text-sm text-red-600 mb-2" role="alert">{{ errors.lines }}</p>
        <LineItemsEditor v-model="lines" :errors="lineErrors" :show-available="false" />
      </section>

      <section v-if="!isEdit" class="card p-4 sm:p-5">
        <label class="flex items-start gap-3 text-sm"><input v-model="form.confirmNow" type="checkbox" class="mt-0.5 size-4 accent-brand-600" /><span><span class="font-medium text-ink">Confirm receipt now</span><span class="block text-muted">The literature is physically on hand and should be added to stock immediately. Otherwise the delivery stays pending until confirmed.</span></span></label>
      </section>

      <div class="sticky bottom-0 -mx-4 lg:mx-0 bg-surface/95 backdrop-blur px-4 py-3 lg:px-0 flex gap-2 justify-end border-t border-brand-100 lg:border-0">
        <AppButton variant="outline" :to="isEdit ? { name: 'delivery-detail', params: { deliveryId } } : { name: 'deliveries' }">Cancel</AppButton>
        <AppButton type="submit" :loading="save.pending.value">{{ isEdit ? 'Save changes' : form.confirmNow ? 'Record and confirm' : 'Record as pending' }}</AppButton>
      </div>
    </form>
  </div>
</template>
