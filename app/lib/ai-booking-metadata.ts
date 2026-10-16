// The first line is immutable machine metadata; owner notes follow it.
export function aiBookingMetadata(notes: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(notes.split('\n')[0]);
    return value && value.source === 'AI Pricer' && typeof value.estimateId === 'string' ? value : null;
  } catch { return null; }
}

export function replaceOwnerNotes(source: string, existing: string, replacement: string) {
  if (source !== 'AI Pricer') return replacement;
  if (!aiBookingMetadata(existing)) throw new Error('AI quote metadata needs review before editing notes.');
  return `${existing.split('\n')[0]}\n${replacement}`;
}
