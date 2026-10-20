<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/services/api'
import { useMutation } from '@/composables/useAsync'
import { useReferenceStore } from '@/stores/reference'
import { useAuthStore } from '@/stores/auth'
import type { LiteratureRequest } from '@/types/api'
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
const requestId = computed(() => (route.params.requestId ? String(route.params.requestId) : ''))
const isEdit = computed(() => !!requestId.value)
const isCong = computed(() => auth.isCongregationUser)

const form = reactive({ congregationId: auth.user?.congregationId || '', requestDate: todayIso(), requestedBy: auth.user?.name || '', notes: '' })
const lines = ref<LineDraft[]>([{ key: 1, itemId: '', quantity: '' }])
const errors = ref<Record<string, string>>({})
const lineErrors = ref<Record<number, string>>({})
const loadError = ref<string | null>(null)
const loading = ref(isEdit.value)

onMounted(async () => {
  await reference.loadCongregations()
  if (!isEdit.value) return
  try {
    const r = await api.call<LiteratureRequest>('requests.get', { requestId: requestId.value })
    if (!['Draft', 'Pending'].includes(r.status)) { router.replace({ name: 'request-detail', params: { requestId: r.requestId } }); return }
    Object.assign(form, { congregationId: r.congregationId, requestDate: r.requestDate, requestedBy: r.requestedBy, notes: r.notes })
    lines.value = (r.items || []).filter((l) => l.requestedQty > 0).map((l, i) => ({ key: i + 1, itemId: l.itemId, quantity: l.requestedQty }))
  } catch (err) {
    loadError.value = (err as Error).message
  } finally {
    loading.value = false
  }
})

function validate() {
  const e: Record<string, string> = {}
  const le: Record<number, string> = {}
  if (!isCong.value && !form.congregationId) e.congregationId = 'Select the requesting congregation.'
  if (!form.requestDate) e.requestDate = 'Request date is required.'
  if (!form.requestedBy.trim()) e.requestedBy = 'Requesting person is required.'
  if (!lines.value.length) e.lines = 'Add at least one literature item.'
  lines.value.forEach((l, i) => {
    if (!l.itemId) le[i] = 'Select an item.'
    else if (l.quantity === '' || Number(l.quantity) <= 0 || !Number.isInteger(Number(l.quantity))) le[i] = 'Quantity must be a positive whole number.'
  })
  errors.value = e
  lineErrors.value = le
  return !Object.keys(e).length && !Object.keys(le).length
}

const save = useMutation(async (requestIdKey: string, submit: boolean) => {
  const params = { ...form, items: lines.value.map((l) => ({ itemId: l.itemId, requestedQty: Number(l.quantity) })) }
  if (isEdit.value) {
    const updated = await api.call<LiteratureRequest>('requests.update', { ...params, requestId: requestId.value }, { requestId: requestIdKey })
    if (submit && updated.status === 'Draft') return api.call<LiteratureRequest>('requests.submit', { requestId: updated.requestId }, { requestId: requestIdKey + ':submit' })
    return updated
  }
  return api.call<LiteratureRequest>('requests.create', { ...params, submit }, { requestId: requestIdKey })
}, { successTitle: 'Request saved' })

async function submit(andSubmit: boolean) {
  if (!validate()) return
  const r = await save.mutate(andSubmit)
  if (r) router.push({ name: 'request-detail', params: { requestId: r.requestId } })
}
</script>

<template>
  <div class="max-w-3xl">
    <PageHeader :title="isEdit ? 'Edit request' : 'New literature request'" subtitle="Requests are reviewed by the East inventory team before literature is released." :back-to="isEdit ? { name: 'request-detail', params: { requestId } } : { name: 'requests' }" />
    <ErrorBanner :message="loadError" class="mb-4" />
    <form v-if="!loading" class="space-y-5" novalidate @submit.prevent="submit(true)">
      <section class="card p-4 sm:p-5 grid gap-4 sm:grid-cols-2">
        <h2 class="sm:col-span-2 font-semibold text-ink">Request details</h2>
        <FormField v-if="!isCong" label="Requesting congregation" for="r-cong" required :error="errors.congregationId">
          <select id="r-cong" v-model="form.congregationId" class="input" :disabled="isEdit"><option value="" disabled>Select…</option><option v-for="c in reference.memberCongregations" :key="c.congregationId" :value="c.congregationId">{{ c.name }}</option></select>
        </FormField>
        <FormField v-else label="Requesting congregation" for="r-cong-ro"><input id="r-cong-ro" class="input" :value="auth.user?.congregationName" disabled /></FormField>
        <FormField label="Request date" for="r-date" required :error="errors.requestDate"><input id="r-date" v-model="form.requestDate" type="date" class="input" /></FormField>
        <FormField label="Requested by" for="r-by" required :error="errors.requestedBy"><input id="r-by" v-model="form.requestedBy" class="input" maxlength="120" /></FormField>
        <div class="sm:col-span-2"><FormField label="Notes" for="r-notes"><textarea id="r-notes" v-model="form.notes" class="input" rows="2" maxlength="1000" placeholder="Purpose, urgency, pickup arrangements…" /></FormField></div>
      </section>
      <section class="card p-4 sm:p-5">
        <h2 class="font-semibold text-ink mb-1">Literature requested</h2>
        <p class="text-xs text-muted mb-3">Available quantities are shown for guidance; the inventory team decides the approved quantity.</p>
        <p v-if="errors.lines" class="text-sm text-red-600 mb-2" role="alert">{{ errors.lines }}</p>
        <LineItemsEditor v-model="lines" :errors="lineErrors" />
      </section>
      <div class="sticky bottom-0 -mx-4 lg:mx-0 bg-surface/95 backdrop-blur px-4 py-3 lg:px-0 flex flex-wrap gap-2 justify-end border-t border-brand-100 lg:border-0">
        <AppButton variant="outline" :to="isEdit ? { name: 'request-detail', params: { requestId } } : { name: 'requests' }">Cancel</AppButton>
        <AppButton variant="secondary" :loading="save.pending.value" @click="submit(false)">Save as draft</AppButton>
        <AppButton type="submit" :loading="save.pending.value">Submit for approval</AppButton>
      </div>
    </form>
  </div>
</template>
