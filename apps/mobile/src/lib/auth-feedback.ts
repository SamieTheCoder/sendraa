import { useEffect, useState } from 'react';

let retryAt = 0;
const listeners = new Set<() => void>();
/** Called only for a real 429; never automatically retries a sign-in POST. */
export function recordAuthRateLimit(response: Response) {
  if (response.status !== 429) return;
  const raw = response.headers.get('retry-after') ?? response.headers.get('x-retry-after');
  const seconds = raw && Number.isFinite(Number(raw)) ? Number(raw) : raw ? Math.ceil((Date.parse(raw) - Date.now()) / 1000) : 60;
  retryAt = Date.now() + Math.max(1, Number.isFinite(seconds) ? seconds : 60) * 1000;
  listeners.forEach((listener) => listener());
}
export function useAuthCooldown() {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    listeners.add(tick);
    tick();
    const timer = setInterval(tick, 1000);
    return () => { listeners.delete(tick); clearInterval(timer); };
  }, []);
  return remaining;
}
export function authError(error: { status?: number; code?: string; message?: string } | null | undefined) {
  if (error?.status === 429) return 'Too many attempts. Wait for the countdown, then try again.';
  if (error?.status === 401) return 'That email and password do not match.';
  if (error?.code === 'SESSION_NOT_FRESH') return 'Sign in again before changing your account security.';
  return error?.message || 'Could not connect to Sendraa. Check your connection and try again.';
}
