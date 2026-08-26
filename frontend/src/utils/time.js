// Backend `created_at` / `updated_at` / `occurred_at` / `last_synced` columns
// are naive UTC (no timezone marker). `new Date("2026-06-12T09:30:00")` would
// read that as LOCAL wall-clock and shift every relative time by the user's
// offset ("1 minute ago" shows as "about 1 hour ago" in the UK summer). Tag
// the string as UTC before parsing so the browser localises it correctly.
//
// Do NOT use this for `meeting_at` / `starts_at`: those are stored as naive
// LOCAL wall-clock on purpose and must be parsed without tagging (parseISO).
export function parseUTC(s) {
  if (!s) return null
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z')
}

// Age as a tag, never an alarm. It never changes colour or wording as it
// grows, and under an hour reads as "now" rather than counting minutes down.
//
// Shared by the In Hand strip and the area cards, so a thing pinned three
// hours ago and an area touched three hours ago say the same "3h". The long
// form ("about 3 hours ago") does not fit either and was never meant to.
export function compactAge(stamp) {
  const then = parseUTC(stamp)
  if (!then) return ''
  const mins = Math.max(0, Math.floor((Date.now() - then.getTime()) / 60000))
  if (mins < 60) return 'now'
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}
