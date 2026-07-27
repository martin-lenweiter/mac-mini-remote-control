// Browser-side fetch helpers for the dashboard.
import type { ActionResult, RigStatus, TerminalActionResult } from '@/lib/types';

function offlineStatus(message: string): RigStatus {
  return {
    sessions: [],
    tunnels: [],
    devServers: [],
    health: null,
    reachable: false,
    error: message,
    fetchedAt: Date.now(),
  };
}

export async function fetchStatus(): Promise<RigStatus> {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    return (await res.json()) as RigStatus;
  } catch (err) {
    // Transport-layer failure (dev server down, offline) — degrade to offline
    // rather than leaving the UI stuck on "Connecting…".
    return offlineStatus(err instanceof Error ? err.message : 'Network error');
  }
}

export async function fetchDirs(path: string): Promise<string[]> {
  try {
    const res = await fetch(`/api/dirs?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
    const data = (await res.json()) as { entries: string[] };
    return data.entries ?? [];
  } catch {
    return [];
  }
}

/** Preload the local naming model so the first launch isn't a cold start. */
export function warmupNamer(): void {
  void fetch('/api/namer/warmup', { method: 'POST' }).catch(() => {});
}

export async function runAction(
  path: string,
  body?: Record<string, unknown>,
  method: 'POST' | 'DELETE' = 'POST',
): Promise<ActionResult> {
  try {
    const res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    return (await res.json()) as ActionResult;
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Request failed' };
  }
}

export async function runTerminalAction(
  path: string,
  body: Record<string, unknown>,
): Promise<TerminalActionResult> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as TerminalActionResult;
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Request failed' };
  }
}
