import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderInput, ChevronRight, Pencil, Check } from 'lucide-react'
import { folioApi, areasApi } from '../api/client'
import { useToast } from './Toast'

/**
 * "Filed under" control on a folio: link the dive to an Area and, optionally,
 * a Thread within it. Areas rarely close; threads conclude often - so the
 * primary home is the area, the thread is a finer pointer.
 *
 * Resting: chips for the linked area (and thread) that navigate there, plus a
 * pencil to change. Editing: an Area select + a Thread select (threads of the
 * chosen area). Saves on change via folioApi.update and pushes the refreshed
 * area/thread back to the parent.
 */
export default function FolioFiledUnder({ folio, onSaved }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [areas, setAreas] = useState(null)
  const [threads, setThreads] = useState([])
  const [saving, setSaving] = useState(false)

  const loadThreads = async (areaId) => {
    if (!areaId) { setThreads([]); return }
    try { setThreads(await areasApi.listThreads(areaId)) } catch { setThreads([]) }
  }

  const open = async () => {
    setEditing(true)
    if (areas === null) {
      try { setAreas(await areasApi.list()) } catch { setAreas([]) }
    }
    if (folio.area?.id) loadThreads(folio.area.id)
  }

  const save = async (patch) => {
    setSaving(true)
    try {
      const updated = await folioApi.update(folio.id, patch)
      onSaved((f) => ({ ...f, area_id: updated.area_id, area: updated.area, thread: updated.thread }))
    } catch (e) {
      toast(e.message || 'Could not file this dive', 'error')
    } finally {
      setSaving(false)
    }
  }

  const onAreaChange = (e) => {
    const id = Number(e.target.value) || 0
    loadThreads(id)
    save({ area_id: id, thread_id: 0 })   // a new area clears the old thread
  }
  const onThreadChange = (e) => save({ thread_id: Number(e.target.value) || 0 })

  const chip = 'inline-flex items-center gap-1 px-2 py-1 rounded-md border border-paper-300 dark:border-pitch-400 ' +
    'bg-paper-100 dark:bg-pitch-700 text-paper-700 dark:text-pitch-100 hover:border-mint/40 transition-colors'

  if (editing) {
    const selCls = 'font-mono text-2xs px-2 py-1 rounded-md bg-paper-100 dark:bg-pitch-700 ' +
      'border border-paper-300 dark:border-pitch-400 text-pitch-800 dark:text-pitch-50 ' +
      'focus:outline-none focus:ring-2 focus:ring-mint-500 disabled:opacity-50'
    return (
      <div className="inline-flex items-center gap-2 flex-wrap">
        <select aria-label="Area" value={folio.area?.id || ''} onChange={onAreaChange} disabled={saving || areas === null} className={selCls}>
          <option value="">No area</option>
          {(areas || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select aria-label="Thread" value={folio.thread?.id || ''} onChange={onThreadChange} disabled={saving || !folio.area || threads.length === 0} className={selCls}>
          <option value="">No thread</option>
          {threads.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
        <button onClick={() => setEditing(false)} aria-label="Done"
          className="p-1 rounded text-mint-700 dark:text-mint-300 hover:bg-paper-200 dark:hover:bg-pitch-600 transition-colors">
          <Check size={14} />
        </button>
      </div>
    )
  }

  if (folio.area) {
    return (
      <div className="inline-flex items-center gap-1.5 font-mono text-2xs">
        <button onClick={() => navigate(`/area/${folio.area.id}`)} className={chip}>
          <FolderInput size={11} className="text-mint" /> {folio.area.name}
        </button>
        {folio.thread && (
          <>
            <ChevronRight size={11} className="text-paper-400 dark:text-pitch-300" />
            <button onClick={() => navigate(`/thread/${folio.thread.id}`)} className={chip}>{folio.thread.title}</button>
          </>
        )}
        <button onClick={open} aria-label="Change where this is filed"
          className="p-1 rounded text-paper-400 dark:text-pitch-300 hover:text-pitch-700 dark:hover:text-pitch-50 transition-colors">
          <Pencil size={11} />
        </button>
      </div>
    )
  }

  return (
    <button onClick={open}
      className="inline-flex items-center gap-1.5 font-mono text-2xs px-2.5 py-1 rounded-md border border-dashed
                 border-paper-400 dark:border-pitch-400 text-paper-500 dark:text-pitch-200
                 hover:border-mint/50 hover:text-pitch-700 dark:hover:text-pitch-50 transition-colors">
      <FolderInput size={11} /> File under an area
    </button>
  )
}
