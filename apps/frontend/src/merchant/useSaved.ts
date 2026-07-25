import { useEffect, useState } from 'react'

// Shared saved-snapshot dirty tracking for the dashboard's save-cycle tabs (#123).
//
// A settings tab holds its own editable `fields`; this hook owns the last-saved snapshot,
// derives dirty by comparing the two through the tab's own `eq`, and reports the flag up to the
// NavGuard. After a successful write the tab calls `commit(applied)` — the read-back
// reconciliation — so the snapshot becomes exactly what the store returned (clamped/canonical),
// not the raw strings that were typed, which clears dirty.
//
// Generic over the field shape `T` with a caller-supplied `eq`, because the tabs do NOT share one
// shape: ShopSettings' tabs are a flat string map (compared via settingsDirty's `isDirty`), while
// FulfilmentTab carries a `number[]` of closed weekdays. A hook hardcoded to one shape is exactly
// what the old `useTabDirty` was — and what FulfilmentTab had to back out of on a type mismatch.
export function useSaved<T>(
  initial: T,
  current: T,
  eq: (a: T, b: T) => boolean,
  onDirtyChange: (dirty: boolean) => void,
): { dirty: boolean; commit: (applied: T) => void } {
  const [saved, setSaved] = useState(initial)
  const dirty = !eq(saved, current)
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  return { dirty, commit: setSaved }
}
