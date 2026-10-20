import { reactive } from 'vue'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  /** When set, the dialog shows a textarea and resolves with its value (required if requireInput). */
  inputLabel?: string
  inputPlaceholder?: string
  requireInput?: boolean
}

interface ConfirmState extends ConfirmOptions {
  open: boolean
  input: string
  resolve: ((value: { confirmed: boolean; input: string }) => void) | null
}

export const confirmState = reactive<ConfirmState>({ open: false, title: '', input: '', resolve: null })

export function useConfirm() {
  function confirm(options: ConfirmOptions): Promise<{ confirmed: boolean; input: string }> {
    return new Promise((resolve) => {
      Object.assign(confirmState, { message: '', confirmText: 'Confirm', cancelText: 'Cancel', danger: false, inputLabel: undefined, inputPlaceholder: '', requireInput: false }, options, { open: true, input: '', resolve })
    })
  }
  return { confirm }
}

export function settleConfirm(confirmed: boolean) {
  const r = confirmState.resolve
  confirmState.open = false
  confirmState.resolve = null
  if (r) r({ confirmed, input: confirmState.input.trim() })
}
