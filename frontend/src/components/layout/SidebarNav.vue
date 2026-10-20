<script setup lang="ts">
import { computed } from 'vue'
import { LayoutDashboard, Package, Truck, ClipboardList, Send, Building2, BarChart3, ShieldCheck } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const ITEMS = [
  { name: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, permissions: ['dashboard.view'] },
  { name: 'inventory', label: 'Literature Inventory', icon: Package, permissions: ['items.view'] },
  { name: 'deliveries', label: 'Incoming Deliveries', icon: Truck, permissions: ['deliveries.view'] },
  { name: 'requests', label: 'Congregation Requests', icon: ClipboardList, permissions: ['requests.view.all', 'requests.view.own'] },
  { name: 'distributions', label: 'Distributions', icon: Send, permissions: ['distributions.view.all', 'distributions.view.own'] },
  { name: 'congregation-stock', label: 'Congregation Stock', icon: Building2, permissions: ['stock.view.all', 'stock.view.own'] },
  { name: 'reports', label: 'Reports', icon: BarChart3, permissions: ['reports.view', 'reports.view.own'] },
  { name: 'admin', label: 'User Management', icon: ShieldCheck, permissions: ['users.manage'] },
]

const visible = computed(() => ITEMS.filter((i) => auth.canAny(i.permissions)))
</script>

<template>
  <nav aria-label="Main">
    <ul class="space-y-1">
      <li v-for="item in visible" :key="item.name">
        <RouterLink
          :to="{ name: item.name }"
          class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-brand-100 hover:bg-white/10 hover:text-white min-h-11"
          active-class="bg-white/15 text-white font-medium"
          :exact-active-class="item.name === 'dashboard' ? 'bg-white/15 text-white font-medium' : ''"
        >
          <component :is="item.icon" class="size-5 shrink-0" aria-hidden="true" />
          <span class="truncate">{{ item.label }}</span>
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
