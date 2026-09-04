/**
 * Whether a status line reports a refusal or a result.
 *
 * The workspace speaks in one channel — `setStatus(text)` — for both "committed
 * C-MT-01" and "cannot delete: the round still holds takeoff". Read at a
 * glance those are the same grey line; only the words tell them apart, and a
 * refusal that fades in four seconds like a confirmation is a refusal nobody
 * saw. So the words are classified here, once, rather than every call site
 * growing a severity argument.
 *
 * The vocabulary is the workspace's own: every refusal it issues begins with
 * "cannot", "could not" or "error", or names a precondition ("needs", "has no
 * length", "first"). A new refusal phrased outside that vocabulary lands as a
 * notice — visible, just not held. Pure, so `statusTone.test.ts` can pin the
 * vocabulary.
 */
export type StatusTone = 'notice' | 'problem'

export function statusTone(text: string): StatusTone {
  const t = text.trim().toLowerCase()
  if (/^(cannot|could not|error\b)/.test(t)) return 'problem'
  if (/\b(needs|has no length)\b/.test(t)) return 'problem'
  if (/ first\b/.test(t) && /^(create|choose|set|open|select)/.test(t)) return 'problem'
  return 'notice'
}

/** How long a line stays up, in milliseconds. A problem is held long enough to read twice. */
export function statusHold(tone: StatusTone): number {
  return tone === 'problem' ? 9000 : 3500
}
