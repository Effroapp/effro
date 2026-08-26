import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { areasApi } from '../api/client'
import { useToast } from './Toast'
import Modal from './Modal'
import IconPicker from './IconPicker'
import MarkdownArea from './MarkdownArea'

export default function NewAreaModal({ isOpen, onClose, onCreated }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    setName('')
    setDescription('')
    setIcon(null)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [isOpen])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setSubmitting(true)
    try {
      const area = await areasApi.create({ name: trimmed, description: description.trim(), icon })
      toast(`Created “${area.name}”`)
      onCreated?.(area)
      onClose()
      navigate(`/area/${area.id}`)
    } catch (e) {
      toast(e.message || 'Failed to create area', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const isDirty = Boolean(name.trim() || description.trim() || icon)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New area" width="max-w-md" isDirty={isDirty}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-sans font-medium uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">
            Name
          </label>
          <div className="flex items-start gap-2">
            <IconPicker value={icon} onChange={setIcon} />
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit() }}
              placeholder="e.g. Customer Portal"
              className="
                flex-1 px-3 py-2 text-sm rounded-lg
                bg-paper-100 dark:bg-pitch-700 border border-paper-300 dark:border-paper-700
                text-pitch-800 dark:text-white
                placeholder:text-paper-400 dark:placeholder:text-paper-700
                focus:outline-none focus:ring-2 focus:ring-mint-500
              "
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-sans font-medium uppercase tracking-wide text-paper-600 dark:text-paper-500 mb-1.5">
            Description <span className="text-paper-400 dark:text-paper-700 normal-case font-mono">- optional</span>
          </label>
          <MarkdownArea
            value={description}
            onChange={setDescription}
            rows={3}
            placeholder="What does this area cover?"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit() }}
            className="bg-paper-100 dark:bg-pitch-700 border-paper-300 dark:border-paper-700"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md text-paper-700 dark:text-paper-400 hover:bg-paper-200 dark:hover:bg-pitch-500 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim() || submitting}
            className="px-4 py-2 text-sm rounded-md font-medium bg-mint-700 hover:bg-mint-800 text-white disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Creating…' : 'Create area'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
