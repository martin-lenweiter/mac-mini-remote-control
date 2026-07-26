// Shared types used by both server (rig.ts, API routes) and client components.
// Keep this file free of any Node-only imports so it is safe in the browser.

export type AgentType = 'cc' | 'cx' | 'sh';

export interface SessionInfo {
  name: string;
  type: AgentType | 'other';
  attached: boolean;
  /** Seconds since last activity. */
  idleSeconds: number;
  /** Unix epoch (seconds) of session creation. */
  createdAt: number;
  /** Ephemeral sessions (timestamp-named) get garbage-collected; named ones don't. */
  ephemeral: boolean;
}

export interface TunnelInfo {
  kind: 'vnc' | 'dev-port';
  localPort: number;
  remotePort: number;
  /** True when the tunnel socket is up locally. */
  up: boolean;
}

export interface DevServer {
  /** Process command name on the mini, e.g. "node". */
  command: string;
  port: number;
  /** Whether a local forward tunnel is currently up for this port. */
  forwarded: boolean;
}

export interface OSUpdateStatus {
  /** Whether Software Update reports a compatible macOS update. */
  available: boolean;
  /** Version offered by Software Update, when one is available. */
  version: string | null;
  /** Unix epoch (ms) when the slower update check last ran. */
  checkedAt: number;
  /** Populated when the update check failed. */
  error: string | null;
}

export type MemoryPressure = 'normal' | 'warning' | 'critical';

export interface MiniHealth {
  /** Combined user + system CPU usage, from 0 to 100. */
  cpuUsedPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  /** System memory-pressure state reported by the macOS kernel. */
  memoryPressure: MemoryPressure;
  /** Usage reported by the root APFS volume, from 0 to 100. */
  diskUsedPercent: number;
  uptimeSeconds: number;
  osVersion: string;
  osUpdate: OSUpdateStatus;
}

export interface RigStatus {
  sessions: SessionInfo[];
  tunnels: TunnelInfo[];
  devServers: DevServer[];
  health: MiniHealth | null;
  /** True if the mini answered the status probe. */
  reachable: boolean;
  /** Populated when reachable is false or a probe failed. */
  error: string | null;
  /** Unix epoch (ms) when this snapshot was taken. */
  fetchedAt: number;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}
