import { useState, useEffect, useRef } from 'react'
import { Ban, MessageSquarePlus } from 'lucide-react'
import Modal from './Modal'
import { THREAD_STATUSES } from '../utils/status'

/**
 * Asks the user to confirm a thread status change.
 *
 *   - When targetStatus === 'blocked', a reason is REQUIRED. The reason is
 *     persisted as a non-collapsible "blockage" entry on the thread timeline
 *     by the caller.
 *   - For any other status, a note is OPTIONAL. If filled in, the caller
 *     creates a regular entry capturing the status change.
 *
 * The modal closes once the caller's onConfirm resolves; submitting state is
 * surfaced via the `submitting` prop so the button can show a saving state.
 */
export default function StatusChangeModal({
  isOpen,
  currentStatus,
  targetStatus,
  onClose,
  onConfirm,
  submitting = false,
}) {
  const [text, setText] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    setText('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [isOpen, targetStatus])

  // Guard: ThreadView keeps the modal mounted with targetStatus=null when
  // closed, so we'd otherwise try to compute labels off a null status.
  if (!isOpen || !targetStatus) return null

  const isBlocking = targetStatus === 'blocked'
  const targetLabel = THREAD_STATUSES[targetStatus]?.label || targetStatus
  const currentLabel = THREAD_STATUSES[currentStatus]?.label || currentStatus

  const canSubmit = isBlocking ? text.trim().length > 0 : true
  // For blocking, the modal always has work to lose. For optional notes,
  // only consider it dirty when the user has actually typed something.
  const isDirty = isBlocking || text.trim().length > 0

  const submit = (e) => {
    e?.preventDefault?.()
    if (!canSubmit || submitting) return
    onConfirm({ text: text.trim() })
  }

  const title = isBlocking
    ? 'Block this thread'
    : `Move to ${targetLabel.toLowerCase()}`

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} width="max-w-md" isDirty={isDirty}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-start gap-3">
          {isBlocking
            ? <Ban size={18} className="text-terracotta flex-shrink-0 mt-0.5" />
            : <MessageSquarePlus size={18} className="text-paper-500 dark:text-paper-600 flex-shrink-0 mt-0.5" />
          }
          <p className="text-sm text-paper-700 dark:text-paper-300 leading-relaxed">
            {isBlocking ? (
              <>
                You're moving this thread from <strong className="text-pitch-800 dark:text-white">{currentLabel}</strong> to <strong className="text-terracotta">Blocked</strong>.
                Every blockage needs a reason - it'll be logged on the timeline so you (and anyone reviewing the area) know why.
              </>
            ) : (
              <>
                Moving from <strong className="text-pitch-800 dark:text-white">{currentLabel}</strong> to <strong className="text-pitch-800 dark:text-white">{targetLabel}</strong>.
                Add a note if helpful - it'll appear on the timeline. Optional.
              </>
            )}
          </p>
        </div>

        <div>
          <label className="block text-xs font-display uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">
            {isBlocking ? (
              <>Reason <span className="text-terracotta">*</span></>
            ) : (
              <>Note <span className="text-paper-400 dark:text-paper-700 normal-case font-mono">- optional</span></>
            )}
          </label>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={isBlocking
              ? 'What is this thread blocked on? Waiting for whom, missing what?'
              : 'Why are you moving this thread? (optional)'
            }
            rows={4}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit() }}
            className="
              w-full px-3 py-2.5 text-sm rounded-lg resize-none
              bg-paper-100 dark:bg-pitch-700 border border-paper-300 dark:border-paper-700
              text-pitch-800 dark:text-white
              placeholder:text-paper-400 dark:placeholder:text-paper-700
              focus:outline-none focus:ring-2 focus:ring-mint-500
            "
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md text-paper-700 dark:text-paper-400 hover:bg-paper-200 dark:hover:bg-pitch-500 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className={`
              flex items-center gap-1.5 px-4 py-2 text-sm rounded-md font-medium text-white
              disabled:opacity-50 transition-colors
              ${isBlocking
                ? 'bg-terracotta hover:bg-terracotta/90'
                : 'bg-mint-700 hover:bg-mint-800'
              }
            `}
          >
            {isBlocking ? <Ban size={13} /> : null}
            {submitting
              ? (isBlocking ? 'Blocking…' : 'Updating…')
              : (isBlocking ? 'Block thread' : `Set to ${targetLabel}`)
            }
          </button>
        </div>
      </form>
    </Modal>
  )
}
