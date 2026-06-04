import Modal from './Modal'
import { AlertTriangle } from 'lucide-react'

export default function ConfirmDialog({ isOpen, onClose, onConfirm, title, message }) {
  const handleConfirm = () => {
    onConfirm()
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title || 'Confirm'} width="max-w-sm">
      <div className="flex gap-3 mb-5">
        <AlertTriangle size={18} className="text-mustard flex-shrink-0 mt-0.5" />
        <p className="text-sm text-paper-700 dark:text-paper-400 leading-relaxed">
          {message || 'This action cannot be undone. Continue?'}
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="
            px-4 py-2 text-sm rounded-md font-medium
            text-paper-700 dark:text-paper-400
            bg-paper-200 dark:bg-pitch-700
            hover:bg-paper-300 dark:hover:bg-pitch-500
            transition-colors
          "
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          className="
            px-4 py-2 text-sm rounded-md font-medium
            text-white bg-terracotta hover:opacity-90
            transition-colors
          "
        >
          Delete
        </button>
      </div>
    </Modal>
  )
}
