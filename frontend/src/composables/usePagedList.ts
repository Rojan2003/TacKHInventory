import { reactive, ref, shallowRef, watch, type Ref } from 'vue'
import { api, describeError } from '@/services/api'
import type { ListParams, Paged } from '@/types/api'

/** Server-driven paged list with search, sort and arbitrary filters. */
export function usePagedList<T, P extends Paged<T> = Paged<T>>(action: string, initial: Partial<ListParams> = {}, options: { pageSize?: number; debounceMs?: number } = {}) {
  const params = reactive<ListParams>({ page: 1, pageSize: options.pageSize || 20, sortBy: '', sortDir: 'asc', query: '', ...initial })
  const page = shallowRef<P | null>(null) as Ref<P | null>
  const loading = ref(false)
  const error = ref<string | null>(null)
  let seq = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  async function load() {
    const my = ++seq
    loading.value = true
    error.value = null
    try {
      const clean: Record<string, unknown> = {}
      Object.entries(params).forEach(([k, v]) => { if (v !== '' && v !== undefined && v !== null) clean[k] = v })
      const res = await api.call<P>(action, clean)
      if (my === seq) page.value = res
    } catch (err) {
      if (my === seq) error.value = describeError(err)
    } finally {
      if (my === seq) loading.value = false
    }
  }

  function scheduleLoad() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(load, options.debounceMs ?? 250)
  }

  watch(() => params.query, () => { params.page = 1; scheduleLoad() })
  watch(() => [params.page, params.pageSize, params.sortBy, params.sortDir], () => load())
  watch(
    () => Object.entries(params).filter(([k]) => !['page', 'pageSize', 'sortBy', 'sortDir', 'query'].includes(k)).map(([, v]) => v),
    () => { params.page = 1; load() },
    { deep: true },
  )

  function sort(key: string) {
    if (params.sortBy === key) params.sortDir = params.sortDir === 'asc' ? 'desc' : 'asc'
    else { params.sortBy = key; params.sortDir = 'asc' }
  }

  function resetFilters(keep: string[] = []) {
    Object.keys(params).forEach((k) => {
      if (['page', 'pageSize', 'sortBy', 'sortDir', ...keep].includes(k)) return
      params[k] = ''
    })
    params.page = 1
  }

  void load()
  return { params, page, loading, error, load, reload: load, sort, resetFilters }
}
