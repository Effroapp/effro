import { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircle, AlertCircle, X } from 'lucide-react'

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext(null)

// How long a toast stays up, by type. Info toasts carry an undo and so get
// longer, since the user has to read them and then decide.
const LIFETIME = { success: 3500, error: 3500, info: 4200 }

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const remove = useCallback((id) => {
    setToasts((t) => t.filter((item) => item.id !== id))
  }, [])

  /**
   * add(message)
   * add(message, 'error')
   * add(message, 'info', { action: { label: 'Undo', onClick }, duration: 4200 })
   *
   * `action` renders one inline button. Pressing it runs the handler and
   * dismisses the toast, so an undo never lingers after it has been taken.
   */
  const add = useCallback((message, type = 'success', options = {}) => {
    const id = Date.now() + Math.random()
    const { action, duration } = options
    setToasts((t) => [...t, { id, message, type, action }])
    setTimeout(() => {
      setToasts((t) => t.filter((item) => item.id !== id))
    }, duration ?? LIFETIME[type] ?? LIFETIME.success)
    return id
  }, [])

  return (
    <ToastContext.Provider value={add}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onRemove={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

// ─── Single toast ─────────────────────────────────────────────────────────────

function Toast({ toast, onRemove }) {
  const isError = toast.type === 'error'
  const isInfo = toast.type === 'info'

  return (
    <div
      className={`
        pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-lg shadow-lg
        border text-sm font-medium animate-slide-in
        bg-white dark:bg-pitch-700
        ${isError ? 'border-terracotta/40 text-terracotta' : ''}
        ${isInfo ? 'border-paper-300 dark:border-pitch-500 text-pitch-800 dark:text-paper-100' : ''}
        ${!isError && !isInfo ? 'border-mint/30 text-mint-700 dark:text-mint-300' : ''}
      `}
    >
      {isError && <AlertCircle size={15} className="flex-shrink-0" />}
      {isInfo && (
        // A quiet sky dot rather than an icon. Info toasts report a thing that
        // already happened, so nothing here should read as a warning.
        <span className="w-1.5 h-1.5 rounded-full bg-sky-muted flex-shrink-0" aria-hidden="true" />
      )}
      {!isError && !isInfo && <CheckCircle size={15} className="flex-shrink-0" />}

      <span className="font-normal">{toast.message}</span>

      {toast.action && (
        <button
          onClick={() => { toast.action.onClick(); onRemove(toast.id) }}
          className="ml-2 font-semibold uppercase text-2xs tracking-[0.09em]
                     text-mint-700 hover:text-mint-800 dark:text-mint-400 dark:hover:text-mint-300
                     transition-colors"
        >
          {toast.action.label}
        </button>
      )}

      <button
        onClick={() => onRemove(toast.id)}
        className="ml-1 p-0.5 rounded opacity-60 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  )
}
