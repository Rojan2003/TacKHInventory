<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Menu, LogOut, X, FlaskConical } from 'lucide-vue-next'
import SidebarNav from './SidebarNav.vue'
import { useAuthStore } from '@/stores/auth'
import { useReferenceStore } from '@/stores/reference'
import { ROLE_LABELS } from '@/types/api'
import { API_MODE } from '@/config'

const auth = useAuthStore()
const reference = useReferenceStore()
const route = useRoute()
const router = useRouter()
const drawer = ref(false)

const appName = import.meta.env.VITE_APP_NAME || 'East Congregation Literature Inventory'
const roleLabel = computed(() => (auth.user ? ROLE_LABELS[auth.user.role] : ''))
const initials = computed(() => (auth.user?.name || auth.user?.email || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join(''))

watch(() => route.fullPath, () => { drawer.value = false })

onMounted(async () => {
  await auth.refresh()
  if (auth.isAuthenticated) {
    void reference.loadCongregations().catch(() => undefined)
    void reference.loadSettings().catch(() => undefined)
  }
})

async function logout() {
  await auth.logout()
  reference.reset()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
    <!-- Sidebar (desktop) -->
    <aside class="hidden lg:flex lg:flex-col bg-brand-800 text-white sticky top-0 h-dvh">
      <div class="px-5 py-5 border-b border-white/10">
        <p class="text-xs uppercase tracking-wider text-brand-200">East Congregation</p>
        <p class="font-semibold leading-tight mt-0.5">Literature Inventory</p>
      </div>
      <SidebarNav class="flex-1 overflow-y-auto px-3 py-4" />
      <div class="border-t border-white/10 p-4 text-sm">
        <div class="flex items-center gap-3">
          <div class="grid size-9 place-items-center rounded-full bg-brand-600 font-semibold">{{ initials }}</div>
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium">{{ auth.user?.name || auth.user?.email }}</p>
            <p class="truncate text-xs text-brand-200">{{ roleLabel }}<span v-if="auth.user?.congregationName"> · {{ auth.user?.congregationName }}</span></p>
          </div>
        </div>
        <button type="button" class="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 hover:bg-white/20 min-h-11" @click="logout">
          <LogOut class="size-4" /> Sign out
        </button>
      </div>
    </aside>

    <!-- Mobile drawer -->
    <Transition enter-active-class="transition duration-150" enter-from-class="opacity-0" leave-active-class="transition duration-100" leave-to-class="opacity-0">
      <div v-if="drawer" class="fixed inset-0 z-40 bg-black/50 lg:hidden" @click.self="drawer = false">
        <div class="h-full w-[82%] max-w-xs bg-brand-800 text-white flex flex-col shadow-2xl" role="dialog" aria-label="Navigation">
          <div class="flex items-center justify-between px-4 py-4 border-b border-white/10">
            <p class="font-semibold">Literature Inventory</p>
            <button type="button" class="rounded-lg p-2 hover:bg-white/10 min-h-11 min-w-11" aria-label="Close menu" @click="drawer = false"><X class="size-5" /></button>
          </div>
          <SidebarNav class="flex-1 overflow-y-auto px-3 py-3" />
          <div class="border-t border-white/10 p-4 text-sm">
            <p class="truncate font-medium">{{ auth.user?.name || auth.user?.email }}</p>
            <p class="truncate text-xs text-brand-200">{{ roleLabel }}<span v-if="auth.user?.congregationName"> · {{ auth.user?.congregationName }}</span></p>
            <button type="button" class="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 min-h-11" @click="logout"><LogOut class="size-4" /> Sign out</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Main -->
    <div class="flex min-h-dvh flex-col min-w-0">
      <header class="sticky top-0 z-30 flex items-center gap-3 border-b border-brand-100/70 bg-white/90 px-4 py-2.5 backdrop-blur lg:px-6">
        <button type="button" class="lg:hidden rounded-lg p-2 hover:bg-gray-100 min-h-11 min-w-11" aria-label="Open menu" @click="drawer = true"><Menu class="size-5" /></button>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold text-ink">{{ route.meta.title || appName }}</p>
          <p class="hidden sm:block truncate text-xs text-muted">{{ appName }}</p>
        </div>
        <span v-if="API_MODE === 'mock'" class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800" title="Running the backend in the browser with demo data">
          <FlaskConical class="size-3.5" /> Demo mode
        </span>
        <div class="hidden lg:grid size-8 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800" :title="auth.user?.email">{{ initials }}</div>
      </header>
      <main class="flex-1 px-4 py-5 lg:px-6 lg:py-6 max-w-[1400px] w-full mx-auto">
        <RouterView />
      </main>
    </div>
  </div>
</template>
