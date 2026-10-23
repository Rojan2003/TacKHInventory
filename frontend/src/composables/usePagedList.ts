import { computed, reactive, ref, watch, type Ref } from 'vue'
import { keepPreviousData, useQuery } from '@tanstack/vue-query'
import { api, describeError } from '@/services/api'
import type { ListParams, Paged } from '@/types/api'

const CONTROL_KEYS = ['page', 'pageSize', 'sortBy', 'sortDir', 'query']

/**
 * Server-driven paged list with search, sort and arbitrary filters, backed by the query cache:
 * a page you have seen before renders instantly and refreshes in the background; while the filters change the
 * previous rows stay visible (dimmed by DataTable) until the new page arrives.
 */
export function usePagedList<T, P extends Paged<T> = Paged<T>>(action: string, initial: Partial<ListParams> = {}, options: { pageSize?: number; debounceMs?: number } = {}) {
  const params = reactive<ListParams>({ page: 1, pageSize: options.pageSize || 20, sortBy: '', sortDir: 'asc', query: '', ...initial })
  const debouncedQuery = ref(String(params.query || ''))
  let timer: ReturnType<typeof setTimeout> | null = null

  watch(() => params.query, (q) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { params.page = 1; debouncedQuery.value = String(q || '') }, options.debounceMs ?? 250)
  })
  watch(
    () => Object.entries(params).filter(([k]) => !CONTROL_KEYS.includes(k)).map(([, v]) => v),
    () => { params.page = 1 },
    { deep: true },
  )

  const clean = computed(() => {
    const out: Record<string, unknown> = {}
    Object.entries(params).forEach(([k, v]) => {
      const val = k === 'query' ? debouncedQuery.value : v
      if (val !== '' && val !== undefined && val !== null) out[k] = val
    })
    return out
  })

  const query = useQuery({
    queryKey: computed(() => [action, clean.value] as const),
    queryFn: () => api.call<P>(action, clean.value),
    placeholderData: keepPreviousData,
  })

  const page = query.data as Ref<P | undefined>
  const loading = computed(() => query.isFetching.value)
  const error = computed(() => (query.error.value ? describeError(query.error.value) : null))
  async function load() { await query.refetch() }

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

  return { params, page, loading, error, load, reload: load, sort, resetFilters }
}
