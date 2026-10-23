<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Plus, Pencil, UserCheck, UserX, Wrench, Database, Eraser } from 'lucide-vue-next'
import { api, describeError } from '@/services/api'
import { useMutation } from '@/composables/useAsync'
import { usePagedList } from '@/composables/usePagedList'
import { useConfirm } from '@/composables/useConfirm'
import { useAuthStore } from '@/stores/auth'
import { useReferenceStore } from '@/stores/reference'
import { useToastStore } from '@/stores/toast'
import { ROLE_LABELS, type AuditEntry, type Congregation, type LegacyImportReport, type ReconcileReport, type Role, type Setting, type User } from '@/types/api'
import { formatDateTime, formatNumber } from '@/utils/format'
import { analyzeEmail } from '@/utils/email'
import PageHeader from '@/components/ui/PageHeader.vue'
import FilterBar from '@/components/ui/FilterBar.vue'
import DataTable, { type Column } from '@/components/ui/DataTable.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import AppButton from '@/components/ui/AppButton.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import Modal from '@/components/ui/Modal.vue'
import FormField from '@/components/ui/FormField.vue'
import DateRange from '@/components/ui/DateRange.vue'

const auth = useAuthStore()
const reference = useReferenceStore()
const toast = useToastStore()
const { confirm } = useConfirm()
const tab = ref<'users' | 'congregations' | 'settings' | 'audit' | 'maintenance'>('users')
const TABS = [['users', 'Users'], ['congregations', 'Congregations'], ['settings', 'Settings'], ['audit', 'Audit log'], ['maintenance', 'Maintenance']] as const
onMounted(() => void reference.loadCongregations(true))

/* ---------- Users ---------- */
const users = usePagedList<User>('users.list', { sortBy: 'email', sortDir: 'asc', role: '', active: '' })
const userColumns: Column[] = [
  { key: 'email', label: 'Account', sortable: true }, { key: 'role', label: 'Role', sortable: true }, { key: 'congregationName', label: 'Congregation', hideOnCard: true },
  { key: 'lastLoginAt', label: 'Last sign-in', sortable: true, hideOnCard: true }, { key: 'active', label: 'Status', align: 'center' },
]
const userDialog = reactive({ open: false, editing: null as User | null })
const userForm = reactive({ email: '', name: '', role: 'read_only' as Role, congregationId: '', active: true })
const userErrors = ref<Record<string, string>>({})
// Live email hints for "Add user": cleaned value, a specific hint, an optional "Did you mean" suggestion (never auto-applied).
const emailInfo = computed(() => analyzeEmail(userForm.email))
const EMAIL_HELP = 'The person signs in with this Google account. Their identity is verified by Google; this list decides who is allowed in.'
const emailHelp = computed(() => (userDialog.editing || !userForm.email ? EMAIL_HELP : emailInfo.value.hint || ''))
function acceptEmailSuggestion() { if (emailInfo.value.suggestion) userForm.email = emailInfo.value.suggestion }
function openUserCreate() { userDialog.editing = null; Object.assign(userForm, { email: '', name: '', role: 'read_only', congregationId: '', active: true }); userErrors.value = {}; userDialog.open = true }
function openUserEdit(u: User) { userDialog.editing = u; Object.assign(userForm, { email: u.email, name: u.name, role: u.role, congregationId: u.congregationId, active: u.active }); userErrors.value = {}; userDialog.open = true }
const saveUser = useMutation(async (rid: string) => {
  if (userDialog.editing) return api.call<User>('users.update', { userId: userDialog.editing.userId, name: userForm.name, role: userForm.role, congregationId: userForm.congregationId, active: userForm.active }, { requestId: rid })
  return api.call<User>('users.create', { email: emailInfo.value.value, name: userForm.name, role: userForm.role, congregationId: userForm.congregationId }, { requestId: rid })
}, { successTitle: 'User saved' })
async function submitUser() {
  const e: Record<string, string> = {}
  if (!userDialog.editing && !emailInfo.value.valid) e.email = emailInfo.value.hint || 'Enter a valid Google account email.'
  if (userForm.role === 'congregation_user' && !userForm.congregationId) e.congregationId = 'Congregation users must be linked to a congregation.'
  userErrors.value = e
  if (Object.keys(e).length) return
  const u = await saveUser.mutate()
  if (u) { userDialog.open = false; void users.reload() }
}
const toggleUser = useMutation((rid: string, u: User) => api.call<User>('users.update', { userId: u.userId, active: !u.active }, { requestId: rid }))
async function onToggle(u: User) {
  const c = await confirm({ title: `${u.active ? 'Deactivate' : 'Reactivate'} ${u.email}?`, message: u.active ? 'The account will lose access immediately, including any open session.' : 'The account will be able to sign in again.', confirmText: u.active ? 'Deactivate' : 'Reactivate', danger: u.active })
  if (!c.confirmed) return
  const res = await toggleUser.mutate(u)
  if (res) { toast.success(res.active ? 'Account reactivated' : 'Account deactivated'); void users.reload() }
}

/* ---------- Congregations ---------- */
const congDialog = reactive({ open: false, editing: null as Congregation | null })
const congForm = reactive({ code: '', name: '', type: 'member' as Congregation['type'], notes: '', active: true })
function openCongCreate() { congDialog.editing = null; Object.assign(congForm, { code: '', name: '', type: 'member', notes: '', active: true }); congDialog.open = true }
function openCongEdit(c: Congregation) { congDialog.editing = c; Object.assign(congForm, { code: c.code, name: c.name, type: c.type, notes: c.notes, active: c.active }); congDialog.open = true }
const saveCong = useMutation((rid: string) => api.call<Congregation>('congregations.save', { ...congForm, congregationId: congDialog.editing?.congregationId }, { requestId: rid }), { successTitle: 'Congregation saved' })
async function submitCong() {
  if (!congForm.code.trim() || !congForm.name.trim()) { toast.error('Code and name are required'); return }
  const c = await saveCong.mutate()
  if (c) { congDialog.open = false; await reference.loadCongregations(true) }
}

/* ---------- Settings ---------- */
const settings = ref<Setting[]>([])
const settingsLoading = ref(false)
const settingsError = ref<string | null>(null)
async function loadSettings() {
  settingsLoading.value = true
  try { settings.value = await api.call<Setting[]>('settings.get') } catch (err) { settingsError.value = describeError(err) } finally { settingsLoading.value = false }
}
const saveSetting = useMutation((rid: string, key: string, value: string) => api.call<Setting[]>('settings.update', { key, value }, { requestId: rid }), { successTitle: 'Setting updated' })
async function updateSetting(key: string, value: string) {
  const res = await saveSetting.mutate(key, value)
  if (res) { settings.value = res; reference.invalidate(['settings']); void reference.loadSettings(true) }
}
const BOOL_KEYS = ['reserveOnApproval', 'allowAdHocDistribution']

/* ---------- Audit ---------- */
const audit = usePagedList<AuditEntry>('audit.list', { sortBy: 'timestamp', sortDir: 'desc', action: '', actor: '', from: '', to: '' })
const auditColumns: Column[] = [
  { key: 'timestamp', label: 'When', sortable: true }, { key: 'actor', label: 'Actor', sortable: true }, { key: 'action', label: 'Action', sortable: true }, { key: 'summary', label: 'Summary' }, { key: 'requestId', label: 'Request ID', hideOnCard: true },
]

/* ---------- Maintenance ---------- */
const reconcileResult = ref<ReconcileReport | null>(null)
const reconcile = useMutation((rid: string, apply: boolean) => api.call<ReconcileReport>('admin.reconcile', { apply }, { requestId: rid }))
async function runReconcile(apply: boolean) {
  if (apply) {
    const c = await confirm({ title: 'Apply reconciliation?', message: 'Balances will be rebuilt from the ledger, request fulfilment recomputed and interrupted distributions finalized or marked failed. Ledger rows are never changed.', confirmText: 'Apply fixes' })
    if (!c.confirmed) return
  }
  const res = await reconcile.mutate(apply)
  if (res) { reconcileResult.value = res; if (apply) { toast.success('Reconciliation applied'); reference.invalidate(['items']) } }
}
const importResult = ref<LegacyImportReport | null>(null)
const importForm = reactive({ month: '', createMissingItems: false })
const legacyImport = useMutation((rid: string, apply: boolean) => api.call<LegacyImportReport>('admin.importLegacyOpeningBalances', { apply, month: importForm.month || undefined, createMissingItems: importForm.createMissingItems }, { requestId: rid }))
async function runImport(apply: boolean) {
  if (apply) {
    const c = await confirm({ title: 'Import legacy opening balances?', message: `This appends OPENING_BALANCE ledger entries from the East_Inventory worksheet for ${importResult.value?.month || 'the latest month'}. It can only be done once. The legacy worksheet is not modified.`, confirmText: 'Import now', danger: true })
    if (!c.confirmed) return
  }
  const res = await legacyImport.mutate(apply)
  if (res) { importResult.value = res; if (apply) { toast.success('Opening balances imported'); reference.invalidate(['items']) } }
}
const clearCache = useMutation((rid: string) => api.call<{ dataVersion: string; cacheEnabled: boolean; ttlSeconds: number }>('admin.clearCache', {}, { requestId: rid }), { successTitle: 'Backend cache cleared' })
const cacheResult = ref<{ dataVersion: string; cacheEnabled: boolean; ttlSeconds: number } | null>(null)
async function runClearCache() { const res = await clearCache.mutate(); if (res) cacheResult.value = res }
const reconcileIssues = computed(() => reconcileResult.value ? reconcileResult.value.balanceFixes.length + reconcileResult.value.fulfilledFixes.length + reconcileResult.value.processingDistributions.length : 0)
</script>

<template>
  <div>
    <PageHeader title="User Management" subtitle="Administrator area: authorized accounts, congregations, settings, audit trail and maintenance.">
      <AppButton v-if="tab === 'users'" @click="openUserCreate"><Plus class="size-4" /> Authorize account</AppButton>
      <AppButton v-if="tab === 'congregations'" @click="openCongCreate"><Plus class="size-4" /> Add congregation</AppButton>
    </PageHeader>

    <div class="mb-4 -mx-4 px-4 overflow-x-auto">
      <div class="inline-flex rounded-xl bg-gray-100 p-1 gap-1" role="tablist">
        <button v-for="t in TABS" :key="t[0]" type="button" role="tab" :aria-selected="tab === t[0]" :class="['rounded-lg px-3 py-2 text-sm whitespace-nowrap min-h-10', tab === t[0] ? 'bg-white shadow text-ink font-medium' : 'text-muted hover:text-ink']" @click="tab = t[0]; if (t[0] === 'settings') loadSettings()">{{ t[1] }}</button>
      </div>
    </div>

    <!-- Users -->
    <section v-if="tab === 'users'" class="card overflow-hidden">
      <ErrorBanner :message="users.error.value" :retry="users.reload" class="m-3" />
      <FilterBar v-model:query="users.params.query as string" placeholder="Search email, name…" show-clear @clear="users.resetFilters()">
        <select v-model="users.params.role" class="input" aria-label="Role"><option value="">All roles</option><option v-for="(label, r) in ROLE_LABELS" :key="r" :value="r">{{ label }}</option></select>
        <select v-model="users.params.active" class="input" aria-label="Status"><option value="">Active and inactive</option><option value="true">Active</option><option value="false">Inactive</option></select>
      </FilterBar>
      <DataTable :columns="userColumns" :rows="users.page.value?.rows || []" row-key="userId" :loading="users.loading.value" :sort-by="users.params.sortBy" :sort-dir="users.params.sortDir" empty-title="No users" @sort="users.sort">
        <template #cell-email="{ row }"><span class="font-medium text-ink">{{ row.name || row.email }}</span><span class="block text-xs text-muted">{{ row.email }}</span></template>
        <template #cell-role="{ row }">{{ ROLE_LABELS[row.role as Role] }}</template>
        <template #cell-lastLoginAt="{ row }"><span class="text-xs">{{ formatDateTime(row.lastLoginAt) }}</span></template>
        <template #cell-active="{ row }"><StatusBadge :status="row.active ? 'Active' : 'Inactive'" size="sm" /></template>
        <template #actions="{ row }">
          <AppButton variant="ghost" size="sm" @click="openUserEdit(row)"><Pencil class="size-4" /><span class="md:sr-only">Edit</span></AppButton>
          <AppButton v-if="row.userId !== auth.user?.userId" variant="ghost" size="sm" @click="onToggle(row)"><component :is="row.active ? UserX : UserCheck" class="size-4" /><span class="md:sr-only">{{ row.active ? 'Deactivate' : 'Reactivate' }}</span></AppButton>
        </template>
      </DataTable>
      <Pagination v-if="users.page.value" :page="users.page.value.page" :total-pages="users.page.value.totalPages" :total="users.page.value.total" :page-size="users.page.value.pageSize" @update:page="(p) => (users.params.page = p)" @update:page-size="(s) => { users.params.pageSize = s; users.params.page = 1 }" />
    </section>

    <!-- Congregations -->
    <section v-else-if="tab === 'congregations'" class="card overflow-hidden">
      <ul class="divide-y divide-gray-100">
        <li v-for="c in reference.congregations" :key="c.congregationId" class="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <div class="min-w-0"><p class="font-medium text-ink">{{ c.name }} <span class="font-mono text-xs text-muted">{{ c.code }}</span></p><p class="text-xs text-muted capitalize">{{ c.type }}<span v-if="c.notes"> · {{ c.notes }}</span></p></div>
          <div class="flex items-center gap-2"><StatusBadge :status="c.active ? 'Active' : 'Inactive'" size="sm" /><AppButton variant="ghost" size="sm" @click="openCongEdit(c)"><Pencil class="size-4" /><span class="sr-only">Edit</span></AppButton></div>
        </li>
      </ul>
    </section>

    <!-- Settings -->
    <section v-else-if="tab === 'settings'" class="card divide-y divide-gray-100">
      <ErrorBanner :message="settingsError" :retry="loadSettings" class="m-3" />
      <div v-if="settingsLoading && !settings.length" class="p-6 animate-pulse h-24" />
      <div v-for="s in settings" :key="s.key" class="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-w-0"><p class="font-medium text-ink font-mono text-sm">{{ s.key }}</p><p class="text-xs text-muted">{{ s.description }}</p></div>
        <div class="sm:w-56">
          <select v-if="BOOL_KEYS.includes(s.key)" class="input" :value="s.value" :disabled="saveSetting.pending.value" :aria-label="s.key" @change="updateSetting(s.key, ($event.target as HTMLSelectElement).value)"><option value="true">Enabled</option><option value="false">Disabled</option></select>
          <input v-else class="input" :value="s.value" :disabled="saveSetting.pending.value" :aria-label="s.key" @change="updateSetting(s.key, ($event.target as HTMLInputElement).value)" />
        </div>
      </div>
    </section>

    <!-- Audit -->
    <section v-else-if="tab === 'audit'" class="card overflow-hidden">
      <ErrorBanner :message="audit.error.value" :retry="audit.reload" class="m-3" />
      <FilterBar v-model:query="audit.params.query as string" placeholder="Search summary, entity…" show-clear @clear="audit.resetFilters()">
        <input v-model="audit.params.actor" class="input" placeholder="Actor email" aria-label="Actor" />
        <input v-model="audit.params.action" class="input" placeholder="Action prefix, e.g. requests." aria-label="Action" />
        <DateRange v-model:from="audit.params.from as string" v-model:to="audit.params.to as string" class="sm:col-span-2" />
      </FilterBar>
      <DataTable :columns="auditColumns" :rows="audit.page.value?.rows || []" row-key="auditId" :loading="audit.loading.value" :sort-by="audit.params.sortBy" :sort-dir="audit.params.sortDir" dense empty-title="No audit entries" @sort="audit.sort">
        <template #cell-timestamp="{ row }"><span class="text-xs whitespace-nowrap">{{ formatDateTime(row.timestamp) }}</span></template>
        <template #cell-action="{ row }"><span class="font-mono text-xs">{{ row.action }}</span></template>
        <template #cell-requestId="{ row }"><span class="font-mono text-[10px] text-muted">{{ row.requestId }}</span></template>
      </DataTable>
      <Pagination v-if="audit.page.value" :page="audit.page.value.page" :total-pages="audit.page.value.totalPages" :total="audit.page.value.total" :page-size="audit.page.value.pageSize" @update:page="(p) => (audit.params.page = p)" @update:page-size="(s) => { audit.params.pageSize = s; audit.params.page = 1 }" />
    </section>

    <!-- Maintenance -->
    <div v-else-if="tab === 'maintenance'" class="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <section class="card p-4 sm:p-5">
        <h2 class="font-semibold text-ink flex items-center gap-2"><Wrench class="size-4 text-brand-600" /> Reconcile balances with the ledger</h2>
        <p class="text-sm text-muted mt-1">Google Sheets has no transactions. If a multi-sheet operation was interrupted, run a dry run to see what differs, then apply. Ledger rows are never modified.</p>
        <div class="mt-3 flex gap-2"><AppButton variant="outline" :loading="reconcile.pending.value" @click="runReconcile(false)">Dry run</AppButton><AppButton :loading="reconcile.pending.value" :disabled="!reconcileResult || !reconcileIssues" @click="runReconcile(true)">Apply fixes</AppButton></div>
        <div v-if="reconcileResult" class="mt-4 text-sm space-y-2">
          <p :class="reconcileIssues ? 'text-amber-700' : 'text-emerald-700'">{{ reconcileResult.applied ? 'Applied.' : 'Dry run:' }} {{ reconcileIssues ? `${reconcileIssues} discrepanc${reconcileIssues === 1 ? 'y' : 'ies'} found.` : 'Everything is consistent.' }}</p>
          <ul v-if="reconcileResult.balanceFixes.length" class="list-disc pl-5 text-xs"><li v-for="f in reconcileResult.balanceFixes" :key="f.itemId">Balance {{ f.itemId }}: cached {{ f.cached ?? 'missing' }} → ledger {{ f.ledger }}</li></ul>
          <ul v-if="reconcileResult.fulfilledFixes.length" class="list-disc pl-5 text-xs"><li v-for="f in reconcileResult.fulfilledFixes" :key="f.requestItemId">Request line {{ f.requestItemId }}: fulfilled {{ f.cached }} → {{ f.computed }}</li></ul>
          <ul v-if="reconcileResult.processingDistributions.length" class="list-disc pl-5 text-xs"><li v-for="f in reconcileResult.processingDistributions" :key="f.distributionId">Distribution {{ f.reference }}: {{ f.action }} (ledger written: {{ f.ledgerWritten ? 'yes' : 'no' }})</li></ul>
        </div>
      </section>
      <section class="card p-4 sm:p-5">
        <h2 class="font-semibold text-ink flex items-center gap-2"><Eraser class="size-4 text-brand-600" /> Clear backend cache</h2>
        <p class="text-sm text-muted mt-1">The backend keeps worksheet reads for up to 2 minutes and drops them automatically after every change made through the app. If you edit the spreadsheet by hand and want the app to show it right away, clear the cache here; the app itself refreshes its own cached pages too.</p>
        <div class="mt-3 flex gap-2"><AppButton variant="outline" :loading="clearCache.pending.value" @click="runClearCache">Clear cache</AppButton></div>
        <p v-if="cacheResult" class="mt-3 text-xs text-muted">Cleared. Backend caching is {{ cacheResult.cacheEnabled ? `on (entries live up to ${cacheResult.ttlSeconds} s)` : 'switched off by the CACHE_ENABLED property' }}.</p>
      </section>
      <section class="card p-4 sm:p-5">
        <h2 class="font-semibold text-ink flex items-center gap-2"><Database class="size-4 text-brand-600" /> Import legacy opening balances</h2>
        <p class="text-sm text-muted mt-1">Reads the latest month of the original East_Inventory worksheet and posts it as opening balances for matching item codes. One-time, append-only; the legacy worksheet is left untouched. Run a dry run first.</p>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <FormField label="Month (yyyy-mm, blank = latest)" for="imp-month"><input id="imp-month" v-model="importForm.month" type="month" class="input" /></FormField>
          <label class="flex items-center gap-2 text-sm sm:mt-7"><input v-model="importForm.createMissingItems" type="checkbox" class="size-4 accent-brand-600" /> Create catalog items for unmatched codes</label>
        </div>
        <div class="mt-3 flex gap-2"><AppButton variant="outline" :loading="legacyImport.pending.value" @click="runImport(false)">Dry run</AppButton><AppButton variant="danger" :loading="legacyImport.pending.value" :disabled="!importResult || importResult.apply" @click="runImport(true)">Import</AppButton></div>
        <div v-if="importResult" class="mt-4 text-sm space-y-2">
          <p>{{ importResult.apply ? 'Imported' : 'Would import' }} {{ importResult.planned.length }} item(s) for {{ importResult.month }}<span v-if="importResult.created.length"> · created {{ importResult.created.join(', ') }}</span></p>
          <ul class="list-disc pl-5 text-xs"><li v-for="p in importResult.planned" :key="p.sku">{{ p.sku }} {{ p.name }}: +{{ formatNumber(p.quantity) }}</li></ul>
          <p v-if="importResult.unmatched.length" class="text-amber-700 text-xs">Unmatched codes (no catalog item): {{ importResult.unmatched.map((u) => `${u.sku} (${u.quantity})`).join(', ') }}</p>
        </div>
      </section>
    </div>

    <!-- User dialog -->
    <Modal :open="userDialog.open" :title="userDialog.editing ? 'Edit authorized account' : 'Authorize a Google account'" @close="userDialog.open = false">
      <form id="user-form" class="space-y-4" @submit.prevent="submitUser">
        <FormField label="Google account email" for="u-email" required :error="userErrors.email" :help="userErrors.email ? '' : emailHelp">
          <input id="u-email" v-model="userForm.email" type="email" class="input" :disabled="!!userDialog.editing" maxlength="160" autocomplete="off" spellcheck="false" @input="userErrors.email = ''" />
          <button v-if="!userDialog.editing && emailInfo.suggestion" type="button" class="mt-1.5 text-sm text-brand-700 hover:underline" data-testid="email-suggestion" @click="acceptEmailSuggestion">Did you mean <span class="font-medium">{{ emailInfo.suggestion }}</span>?</button>
          <p v-if="!userDialog.editing && emailInfo.valid && !emailInfo.isGoogleDomain" class="mt-1.5 text-xs text-muted" data-testid="email-google-note">This person must sign in with a Google account that uses exactly this address.</p>
        </FormField>
        <FormField label="Display name" for="u-name"><input id="u-name" v-model="userForm.name" class="input" maxlength="120" /></FormField>
        <FormField label="Role" for="u-role" required><select id="u-role" v-model="userForm.role" class="input"><option v-for="(label, r) in ROLE_LABELS" :key="r" :value="r">{{ label }}</option></select></FormField>
        <FormField label="Congregation" for="u-cong" :required="userForm.role === 'congregation_user'" :error="userErrors.congregationId" help="Required for congregation users; scopes what they can see and request."><select id="u-cong" v-model="userForm.congregationId" class="input"><option value="">None</option><option v-for="c in reference.memberCongregations" :key="c.congregationId" :value="c.congregationId">{{ c.name }}</option></select></FormField>
        <label v-if="userDialog.editing" class="flex items-center gap-2 text-sm min-h-11"><input v-model="userForm.active" type="checkbox" class="size-4 accent-brand-600" :disabled="userDialog.editing.userId === auth.user?.userId" /> Active</label>
      </form>
      <template #footer><AppButton variant="outline" @click="userDialog.open = false">Cancel</AppButton><AppButton type="submit" form="user-form" :loading="saveUser.pending.value">{{ userDialog.editing ? 'Save changes' : 'Authorize' }}</AppButton></template>
    </Modal>

    <!-- Congregation dialog -->
    <Modal :open="congDialog.open" :title="congDialog.editing ? 'Edit congregation' : 'Add congregation'" size="sm" @close="congDialog.open = false">
      <form id="cong-form" class="space-y-4" @submit.prevent="submitCong">
        <FormField label="Code" for="c-code" required><input id="c-code" v-model="congForm.code" class="input uppercase" maxlength="20" :disabled="congDialog.editing?.type === 'coordinator'" /></FormField>
        <FormField label="Name" for="c-name" required><input id="c-name" v-model="congForm.name" class="input" maxlength="120" /></FormField>
        <FormField label="Type" for="c-type"><select id="c-type" v-model="congForm.type" class="input" :disabled="congDialog.editing?.type === 'coordinator'"><option value="member">Member congregation</option><option value="supplier">Supplier</option><option value="coordinator">Coordinator (holds stock)</option></select></FormField>
        <FormField label="Notes" for="c-notes"><textarea id="c-notes" v-model="congForm.notes" class="input" rows="2" maxlength="500" /></FormField>
        <label v-if="congDialog.editing && congDialog.editing.type !== 'coordinator'" class="flex items-center gap-2 text-sm min-h-11"><input v-model="congForm.active" type="checkbox" class="size-4 accent-brand-600" /> Active</label>
      </form>
      <template #footer><AppButton variant="outline" @click="congDialog.open = false">Cancel</AppButton><AppButton type="submit" form="cong-form" :loading="saveCong.pending.value">Save</AppButton></template>
    </Modal>
  </div>
</template>
