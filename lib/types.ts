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

export interface ChromeHealth {
  loaded: boolean;
  running: boolean;
  pid: number | null;
}

export interface RigStatus {
  sessions: SessionInfo[];
  tunnels: TunnelInfo[];
  devServers: DevServer[];
  chrome: ChromeHealth;
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
