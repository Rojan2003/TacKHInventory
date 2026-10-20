import { ref, shallowRef, type Ref } from 'vue'
import { describeError, newRequestId } from '@/services/api'
import { useToastStore } from '@/stores/toast'

/** Tracks loading/error state around an async loader. */
export function useAsync<T>(loader: () => Promise<T>, options: { immediate?: boolean; initial?: T } = {}) {
  const data = shallowRef<T | undefined>(options.initial) as Ref<T | undefined>
  const loading = ref(false)
  const error = ref<string | null>(null)
  let seq = 0

  async function run(): Promise<T | undefined> {
    const my = ++seq
    loading.value = true
    error.value = null
    try {
      const result = await loader()
      if (my === seq) data.value = result
      return result
    } catch (err) {
      if (my === seq) error.value = describeError(err)
      return undefined
    } finally {
      if (my === seq) loading.value = false
    }
  }

  if (options.immediate !== false) void run()
  return { data, loading, error, run, reload: run }
}

/**
 * Wraps a mutating API call with a stable requestId: a retry of the same logical submission reuses the
 * id so the backend de-duplicates it. The id rotates only after a success.
 */
export function useMutation<TArgs extends unknown[], TResult>(fn: (requestId: string, ...args: TArgs) => Promise<TResult>, opts: { successTitle?: string; errorTitle?: string } = {}) {
  const toast = useToastStore()
  const pending = ref(false)
  const error = ref<string | null>(null)
  let requestId = newRequestId()

  async function mutate(...args: TArgs): Promise<TResult | undefined> {
    if (pending.value) return undefined // ignore double clicks while in flight
    pending.value = true
    error.value = null
    try {
      const result = await fn(requestId, ...args)
      requestId = newRequestId()
      if (opts.successTitle) toast.success(opts.successTitle)
      return result
    } catch (err) {
      error.value = describeError(err)
      toast.error(opts.errorTitle || 'Action failed', error.value)
      return undefined
    } finally {
      pending.value = false
    }
  }
  return { mutate, pending, error }
}
