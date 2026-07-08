/**
 * Process-local in-flight guard for expensive, non-idempotent work (LLM
 * calls). Guards the check-then-act window so concurrent requests for the
 * same key (second tab, double-click) can't double-bill.
 *
 * Scope: a Set in process memory — correct for a single API container, NOT a
 * distributed lock. If the API ever scales past one instance, replace with a
 * DB- or Redis-backed lock.
 */
export function createInFlightGuard() {
  const inFlight = new Set<string>();
  return {
    /** Reserves the key and returns true, or returns false if already running. */
    tryAcquire(key: string): boolean {
      if (inFlight.has(key)) return false;
      inFlight.add(key);
      return true;
    },
    release(key: string): void {
      inFlight.delete(key);
    },
  };
}
