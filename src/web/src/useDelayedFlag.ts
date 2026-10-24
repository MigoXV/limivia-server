import { useEffect, useState } from 'react'

// Each activation has its own identity, so a previous timer cannot leak into a new scope.
export function useDelayedFlag(active: boolean, scope: string, delay = 300) {
  const [activation, setActivation] = useState({ active, scope })
  const [visibleFor, setVisibleFor] = useState<typeof activation | null>(null)
  if (activation.active !== active || activation.scope !== scope) setActivation({ active, scope })
  useEffect(() => {
    if (!activation.active) return
    const timer = setTimeout(() => setVisibleFor(activation), delay)
    return () => clearTimeout(timer)
  }, [activation, delay])
  return active && activation.scope === scope && visibleFor === activation
}
