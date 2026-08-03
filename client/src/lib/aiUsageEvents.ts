/**
 * Tiny pub/sub so AuthContext can refresh the AI-calls-used badge right after
 * a generation settles, without every AI-feature component needing to know
 * about AuthContext. apiFetch (lib/api.ts) is the single place that notifies;
 * AuthContext is the only subscriber.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function notifyAiUsage(): void {
  listeners.forEach((listener) => listener());
}

/** Returns an unsubscribe function. */
export function onAiUsage(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
