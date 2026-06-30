// Pure formatting helpers, safe on client and server.

export function formatIdle(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export const TYPE_LABEL: Record<string, string> = {
  cc: 'Claude',
  cx: 'Codex',
  sh: 'Shell',
  other: 'Other',
};
