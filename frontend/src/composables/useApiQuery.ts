import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/vue-query'
import { api, describeError } from '@/services/api'

function cleanParams(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  Object.entries(p).forEach(([k, v]) => { if (v !== '' && v !== undefined && v !== null) out[k] = v })
  return out
}

/**
 * Cached read of one backend action. Cached data shows immediately; a background refetch runs when the entry
 * is older than STALE_MS or after a related mutation. `loading` is true whenever a fetch is in flight (for
 * refresh buttons); use `loading && !data` for skeletons so they only appear before the first data arrives.
 * `setData` writes a value a mutation just returned into the cache so the page updates without waiting.
 */
export function useApiQuery<T>(action: string, params: MaybeRefOrGetter<Record<string, unknown>> = {}, options: { enabled?: MaybeRefOrGetter<boolean>; keepPrevious?: boolean } = {}) {
  const client = useQueryClient()
  const clean = computed(() => cleanParams(toValue(params)))
  const queryKey = computed(() => [action, clean.value] as const)
  const query = useQuery({
    queryKey,
    queryFn: () => api.call<T>(action, clean.value),
    enabled: computed(() => toValue(options.enabled ?? true)),
    placeholderData: options.keepPrevious === false ? undefined : keepPreviousData,
  })
  const loading = computed(() => query.isFetching.value)
  const error = computed(() => (query.error.value ? describeError(query.error.value) : null))
  const reload = () => query.refetch()
  const setData = (value: T) => { client.setQueryData(queryKey.value, value) }
  return { data: query.data, loading, error, reload, setData, query }
}
