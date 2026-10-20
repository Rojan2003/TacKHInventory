<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BookOpen, Loader2, AlertTriangle, FlaskConical, RotateCcw } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { describeError, ApiError } from '@/services/api'
import { loadGoogleIdentity } from '@/services/google'
import { API_MODE } from '@/config'
import AppButton from '@/components/ui/AppButton.vue'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const apiUrl = import.meta.env.VITE_API_BASE_URL || ''

const buttonHost = ref<HTMLElement | null>(null)
const loadingGis = ref(API_MODE === 'http')
const signingIn = ref(false)
const error = ref<string | null>(null)
const unauthorizedEmail = ref<string | null>(null)
const mockAccounts = ref<{ email: string; name: string; role: string }[]>([])
/** Optional real photo: place it at frontend/public/login-photo.jpg. The illustration is used until then. */
const photoFailed = ref(false)
const photoUrl = `${import.meta.env.BASE_URL}login-photo.jpg`

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
    if (err instanceof ApiError && err.code === 'UNAUTHORIZED') unauthorizedEmail.value = err.message
    else error.value = describeError(err)
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
    gis.initialize({ client_id: clientId, callback: (res) => void completeLogin(res.credential), auto_select: false, ux_mode: 'popup', itp_support: true })
    if (buttonHost.value) gis.renderButton(buttonHost.value, { theme: 'outline', size: 'large', shape: 'rectangular', text: 'signin_with', width: 320, logo_alignment: 'left' })
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
  <div class="min-h-dvh bg-surface flex items-center justify-center p-3 sm:p-6">
    <div class="w-full max-w-[1120px] grid overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-card md:grid-cols-[2fr_3fr] md:min-h-[600px]">
      <!-- Left: sign-in -->
      <section class="flex flex-col justify-center px-6 py-10 sm:px-10 lg:px-14">
        <div class="flex items-center gap-2.5">
          <div class="grid size-9 place-items-center rounded-lg bg-brand-700 text-white"><BookOpen class="size-5" /></div>
          <div class="leading-tight">
            <p class="text-sm font-bold tracking-wide text-brand-800 uppercase">East Congregation</p>
            <p class="text-[11px] font-semibold tracking-[0.2em] text-brand-500 uppercase">Literature</p>
          </div>
        </div>

        <h1 class="mt-10 text-3xl sm:text-4xl font-bold text-ink leading-tight">Sign in to Inventory</h1>

        <div v-if="expired && !error && !unauthorizedEmail" class="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">Your session has expired. Please sign in again.</div>

        <div class="mt-6 min-h-12 flex flex-col items-start gap-3">
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
            <div v-show="!loadingGis" ref="buttonHost" class="w-full max-w-[320px]" />
            <div v-if="loadingGis || signingIn" class="flex items-center gap-2 text-sm text-muted"><Loader2 class="size-4 animate-spin" /> {{ signingIn ? 'Verifying your account…' : 'Loading Google Sign-In…' }}</div>
          </template>
        </div>

        <div v-if="unauthorizedEmail" class="mt-4 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800" role="alert">
          <p class="font-medium">This account is not authorized.</p>
          <p class="mt-1">{{ unauthorizedEmail }}</p>
        </div>
        <div v-else-if="error" class="mt-4 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800 flex gap-2" role="alert"><AlertTriangle class="size-5 shrink-0" /><span>{{ error }}</span></div>

        <p class="mt-6 text-sm text-muted max-w-sm">Access is restricted to authorized congregation accounts. Your Google identity is verified and checked against the authorized-user list; sign-ins are recorded.</p>
        <AppButton v-if="auth.isAuthenticated" class="mt-4 self-start" variant="secondary" :to="{ name: 'dashboard' }">Continue to dashboard</AppButton>
      </section>

      <!-- Right: visual -->
      <aside class="relative hidden md:block bg-brand-800 overflow-hidden" aria-hidden="true">
        <img v-if="!photoFailed" :src="photoUrl" alt="" class="absolute inset-0 h-full w-full object-cover" @error="photoFailed = true" />
        <svg v-else class="absolute inset-0 h-full w-full" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2c594a" /><stop offset="1" stop-color="#17302a" /></linearGradient>
            <radialGradient id="glow" cx="0.7" cy="0.3" r="0.6"><stop offset="0" stop-color="#9adbc7" stop-opacity="0.35" /><stop offset="1" stop-color="#9adbc7" stop-opacity="0" /></radialGradient>
            <linearGradient id="shelf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b4f3a" /><stop offset="1" stop-color="#3f2d20" /></linearGradient>
          </defs>
          <rect width="600" height="600" fill="url(#bg)" />
          <rect width="600" height="600" fill="url(#glow)" />
          <!-- shelf -->
          <rect x="60" y="440" width="480" height="16" rx="3" fill="url(#shelf)" />
          <rect x="60" y="456" width="480" height="6" rx="2" fill="#2a1d15" opacity="0.6" />
          <!-- books -->
          <g>
            <rect x="110" y="250" width="44" height="190" rx="3" fill="#3a8570" /><rect x="118" y="270" width="28" height="4" fill="#e7efec" opacity="0.7" /><rect x="118" y="282" width="28" height="4" fill="#e7efec" opacity="0.4" />
            <rect x="158" y="230" width="38" height="210" rx="3" fill="#e7efec" /><rect x="165" y="250" width="24" height="5" fill="#2c594a" /><rect x="165" y="262" width="24" height="3" fill="#2c594a" opacity="0.5" />
            <rect x="200" y="270" width="50" height="170" rx="3" fill="#9adbc7" /><rect x="209" y="292" width="32" height="5" fill="#17302a" opacity="0.8" />
            <rect x="254" y="215" width="36" height="225" rx="3" fill="#4fa58c" /><rect x="261" y="240" width="22" height="4" fill="#e7efec" opacity="0.8" />
            <g transform="rotate(-9 330 440)"><rect x="300" y="245" width="46" height="195" rx="3" fill="#d2e5de" /><rect x="308" y="268" width="30" height="5" fill="#2c594a" /></g>
            <rect x="358" y="262" width="40" height="178" rx="3" fill="#22453a" stroke="#4fa58c" stroke-width="1.5" /><rect x="366" y="284" width="24" height="4" fill="#9adbc7" />
            <rect x="402" y="236" width="52" height="204" rx="3" fill="#6fc2a9" /><rect x="412" y="258" width="32" height="5" fill="#17302a" opacity="0.8" /><rect x="412" y="270" width="32" height="3" fill="#17302a" opacity="0.4" />
            <rect x="458" y="280" width="34" height="160" rx="3" fill="#e7efec" /><rect x="465" y="300" width="20" height="4" fill="#3a8570" />
          </g>
          <!-- magazines stacked on the shelf -->
          <g transform="translate(300 480)">
            <rect x="0" y="0" width="160" height="14" rx="2" fill="#e7efec" /><rect x="6" y="16" width="150" height="14" rx="2" fill="#d2e5de" /><rect x="12" y="32" width="140" height="14" rx="2" fill="#9adbc7" />
            <rect x="12" y="4" width="60" height="6" fill="#2c594a" opacity="0.7" />
          </g>
        </svg>
        <div v-if="photoFailed" class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-brand-900/80 to-transparent px-8 pb-7 pt-16">
          <p class="text-lg font-semibold text-brand-50">Receive · Track · Distribute</p>
          <p class="text-sm text-brand-200">East, SLC, Central, West and Tagalog congregations</p>
        </div>
      </aside>
    </div>
  </div>
</template>
