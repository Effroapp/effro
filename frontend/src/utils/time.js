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
