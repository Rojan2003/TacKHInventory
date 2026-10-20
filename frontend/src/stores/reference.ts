/**
 * Small, frequently reused reference data (congregations, settings, active items for pickers).
 * Cached per session and invalidated after mutations that affect it.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/services/api'
import type { Congregation, Item, ItemsPage, Setting } from '@/types/api'

export const useReferenceStore = defineStore('reference', () => {
  const congregations = ref<Congregation[]>([])
  const settings = ref<Record<string, string>>({})
  const items = ref<Item[]>([])
  const loadedAt = ref<{ congregations: number; settings: number; items: number }>({ congregations: 0, settings: 0, items: 0 })

  const coordinator = computed(() => congregations.value.find((c) => c.type === 'coordinator') || null)
  const memberCongregations = computed(() => congregations.value.filter((c) => c.type !== 'coordinator' && c.active))
  const reserveOnApproval = computed(() => settings.value.reserveOnApproval !== 'false')
  const allowAdHocDistribution = computed(() => settings.value.allowAdHocDistribution === 'true')

  async function loadCongregations(force = false) {
    if (!force && loadedAt.value.congregations && Date.now() - loadedAt.value.congregations < 5 * 60_000) return congregations.value
    congregations.value = await api.call<Congregation[]>('congregations.list', { includeInactive: true })
    loadedAt.value.congregations = Date.now()
    return congregations.value
  }

  async function loadSettings(force = false) {
    if (!force && loadedAt.value.settings && Date.now() - loadedAt.value.settings < 5 * 60_000) return settings.value
    const list = await api.call<Setting[]>('settings.get')
    settings.value = Object.fromEntries(list.map((s) => [s.key, s.value]))
    loadedAt.value.settings = Date.now()
    return settings.value
  }

  /** Active items with live balances, for pickers. Always fresh when force=true (stock changes often). */
  async function loadItems(force = false) {
    if (!force && loadedAt.value.items && Date.now() - loadedAt.value.items < 30_000) return items.value
    const page = await api.call<ItemsPage>('items.list', { page: 1, pageSize: 200, sortBy: 'name' })
    items.value = page.rows
    loadedAt.value.items = Date.now()
    return items.value
  }

  function congregationName(id: string): string {
    return congregations.value.find((c) => c.congregationId === id)?.name || ''
  }

  function invalidate(what: Array<'congregations' | 'settings' | 'items'> = ['congregations', 'settings', 'items']) {
    what.forEach((k) => { loadedAt.value[k] = 0 })
  }

  function reset() {
    congregations.value = []
    settings.value = {}
    items.value = []
    invalidate()
  }

  return { congregations, settings, items, coordinator, memberCongregations, reserveOnApproval, allowAdHocDistribution, loadCongregations, loadSettings, loadItems, congregationName, invalidate, reset }
})
