<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BookOpen, ShieldCheck, Loader2, AlertTriangle, FlaskConical, RotateCcw } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { describeError, ApiError } from '@/services/api'
import { loadGoogleIdentity } from '@/services/google'
import { API_MODE } from '@/config'
import AppButton from '@/components/ui/AppButton.vue'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const appName = import.meta.env.VITE_APP_NAME || 'East Congregation Literature Inventory'
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const apiUrl = import.meta.env.VITE_API_BASE_URL || ''

const buttonHost = ref<HTMLElement | null>(null)
const loadingGis = ref(API_MODE === 'http')
const signingIn = ref(false)
const error = ref<string | null>(null)
const unauthorizedEmail = ref<string | null>(null)
const mockAccounts = ref<{ email: string; name: string; role: string }[]>([])

const configError = computed(() => {
  if (API_MODE === 'mock') return null
  if (!clientId) return 'The Google client ID is not configured (VITE_GOOGLE_CLIENT_ID).'
  if (!apiUrl) return 'The backend URL is not configured (VITE_API_BASE_URL).'
  return null
})

const expired = computed(() => route.query.reason === 'expired')

async function completeLogin(idToken: string) {
  signingIn.value = true
  error.value = null
  unauthorizedEmail.value = null
  try {
    await auth.loginWithIdToken(idToken)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    router.replace(redirect)
  } catch (err) {
    if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
      unauthorizedEmail.value = err.message
    } else {
      error.value = describeError(err)
    }
  } finally {
    signingIn.value = false
  }
}

onMounted(async () => {
  if (import.meta.env.VITE_API_MODE === 'mock') {
    const { MOCK_ACCOUNTS } = await import('@/services/mockTransport')
    mockAccounts.value = MOCK_ACCOUNTS
    return
  }
  if (configError.value) { loadingGis.value = false; return }
  try {
    const gis = await loadGoogleIdentity()
    gis.initialize({
      client_id: clientId,
      callback: (res) => void completeLogin(res.credential),
      auto_select: false,
      ux_mode: 'popup',
      itp_support: true,
    })
    if (buttonHost.value) {
      gis.renderButton(buttonHost.value, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 300, logo_alignment: 'left' })
    }
  } catch (err) {
    error.value = describeError(err)
  } finally {
    loadingGis.value = false
  }
})

async function resetDemo() {
  if (import.meta.env.VITE_API_MODE !== 'mock') return
  const { resetMockData } = await import('@/services/mockTransport')
  resetMockData()
  error.value = null
  unauthorizedEmail.value = null
}
</script>

<template>
  <div class="min-h-dvh flex flex-col lg:flex-row bg-surface">
    <!-- Brand panel -->
    <section class="bg-brand-800 text-white px-6 py-10 lg:w-5/12 lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-16">
      <div>
        <div class="inline-flex items-center gap-3">
          <div class="grid size-12 place-items-center rounded-2xl bg-white/15"><BookOpen class="size-6" /></div>
          <div>
            <p class="text-xs uppercase tracking-wider text-brand-200">Sign in to</p>
            <p class="text-lg font-semibold leading-tight">{{ appName }}</p>
          </div>
        </div>
        <h1 class="mt-8 text-2xl lg:text-4xl font-semibold leading-tight max-w-md">Receive, track and distribute literature across the congregations.</h1>
        <p class="mt-4 text-brand-100 max-w-md">One place for East's physical stock, incoming deliveries, congregation requests, releases and receipts.</p>
      </div>
      <p class="mt-10 text-xs text-brand-200/80 hidden lg:block">Coordinating literature for East, SLC, Central, West and Tagalog congregations.</p>
    </section>

    <!-- Sign-in panel -->
    <section class="flex-1 flex items-center justify-center px-4 py-10 lg:px-14">
      <div class="w-full max-w-md card p-6 sm:p-8">
        <h2 class="text-xl font-semibold text-ink">Sign in</h2>
        <p class="mt-1 text-sm text-muted">Use the Google account that has been authorized for this system.</p>

        <div v-if="expired && !error && !unauthorizedEmail" class="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">Your session has expired. Please sign in again.</div>

        <div class="mt-6 min-h-16 flex flex-col items-center justify-center gap-3">
          <div v-if="configError" class="w-full rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800 flex gap-2"><AlertTriangle class="size-5 shrink-0" />{{ configError }}</div>

          <template v-else-if="API_MODE === 'mock'">
            <div class="w-full rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex gap-2"><FlaskConical class="size-4 shrink-0" /> Demo mode: the backend runs in your browser with sample data. No Google sign-in is performed.</div>
            <div class="w-full grid gap-2">
              <button v-for="a in mockAccounts" :key="a.email" type="button" class="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2.5 text-left text-sm hover:border-brand-400 hover:bg-brand-50 min-h-11 disabled:opacity-50" :disabled="signingIn" @click="completeLogin(`mock:${a.email}:${a.name}`)">
                <span><span class="font-medium text-ink">{{ a.name }}</span><span class="block text-xs text-muted">{{ a.email }}</span></span>
                <span class="text-xs text-muted">{{ a.role }}</span>
              </button>
            </div>
            <button type="button" class="text-xs text-muted inline-flex items-center gap-1 hover:text-ink" @click="resetDemo"><RotateCcw class="size-3.5" /> Reset demo data</button>
          </template>

          <template v-else>
            <div v-show="!loadingGis" ref="buttonHost" class="flex justify-center" />
            <div v-if="loadingGis || signingIn" class="flex items-center gap-2 text-sm text-muted"><Loader2 class="size-4 animate-spin" /> {{ signingIn ? 'Verifying your account…' : 'Loading Google Sign-In…' }}</div>
          </template>
        </div>

        <div v-if="unauthorizedEmail" class="mt-4 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800" role="alert">
          <p class="font-medium">This account is not authorized.</p>
          <p class="mt-1">{{ unauthorizedEmail }}</p>
        </div>
        <div v-else-if="error" class="mt-4 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800 flex gap-2" role="alert"><AlertTriangle class="size-5 shrink-0" /><span>{{ error }}</span></div>

        <div class="mt-6 flex gap-2 rounded-xl bg-gray-50 p-3 text-xs text-muted">
          <ShieldCheck class="size-4 shrink-0 text-brand-600" />
          <p>Access is restricted to authorized congregation accounts. Your identity is verified with Google and checked against the authorized-user list on the server. Signing in is recorded.</p>
        </div>
        <AppButton v-if="auth.isAuthenticated" class="mt-4" block variant="secondary" :to="{ name: 'dashboard' }">Continue to dashboard</AppButton>
      </div>
    </section>
  </div>
</template>
