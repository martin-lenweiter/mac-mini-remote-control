import { execFile } from 'node:child_process';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { RIG } from '@/lib/config';
import { generateSessionSlug, slugify } from '@/lib/naming';
import type {
  AgentType,
  ChromeHealth,
  DevServer,
  RigStatus,
  SessionInfo,
  TunnelInfo,
} from '@/lib/types';

const pexec = promisify(execFile);

// --- guards ---------------------------------------------------------------
// All operations that interpolate values into a shell-bound command validate
// against these allowlists first. Names/repos also come from live rig data,
// so callers double-check membership before acting.
const NAME_RE = /^[A-Za-z0-9._-]+$/;

function assertName(value: string, label: string): void {
  if (!NAME_RE.test(value)) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(value)}`);
  }
}

function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }
}

// Paths/labels are interpolated unquoted into remote shell commands. Allow only
// characters that cannot break out of the command (no quotes, spaces, $, ;, etc.).
const SAFE_PATH_RE = /^[~A-Za-z0-9._/-]+$/;
const SAFE_LABEL_RE = /^[A-Za-z0-9._-]+$/;

function assertSafe(value: string, re: RegExp, label: string): string {
  if (!re.test(value)) throw new Error(`Unsafe ${label}: ${JSON.stringify(value)}`);
  return value;
}

// --- ssh read probes ------------------------------------------------------
function sshArgs(remoteCmd: string): string[] {
  return [
    '-o',
    'BatchMode=yes',
    '-o',
    `ConnectTimeout=${RIG.connectTimeout}`,
    RIG.sshAlias,
    remoteCmd,
  ];
}

async function sshRead(remoteCmd: string, timeoutMs = 9000): Promise<string> {
  const { stdout } = await pexec('ssh', sshArgs(remoteCmd), { timeout: timeoutMs });
  return stdout;
}

// PATH prefix so non-login ssh commands find Homebrew tools (tmux, etc.).
const PATH_PREFIX = 'export PATH=/opt/homebrew/bin:$HOME/.local/bin:$PATH;';

// --- parsers --------------------------------------------------------------
const EPHEMERAL_RE = /^(cc|cx|sh)-\d+$/;

function classify(name: string): AgentType | 'other' {
  if (name.startsWith('cc-')) return 'cc';
  if (name.startsWith('cx-')) return 'cx';
  if (name.startsWith('sh-')) return 'sh';
  return 'other';
}

export function parseSessions(stdout: string, nowSec: number): SessionInfo[] {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line): SessionInfo | null => {
      const parts = line.split('|');
      // Skip anything that isn't a well-formed 4-field record (e.g. a stray
      // tmux warning that slipped past `2>/dev/null`).
      if (parts.length < 4) return null;
      const [name, attached, activity, created] = parts;
      if (!name) return null;
      const activitySec = Number(activity);
      return {
        name,
        type: classify(name),
        attached: attached === '1',
        idleSeconds: Math.max(0, nowSec - (Number.isFinite(activitySec) ? activitySec : nowSec)),
        createdAt: Number(created) || 0,
        ephemeral: EPHEMERAL_RE.test(name),
      } satisfies SessionInfo;
    })
    .filter((s): s is SessionInfo => s !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function parseDirListing(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((l) => l.trim().replace(/\/$/, ''))
    .filter(Boolean)
    .map((p) => p.split('/').pop() ?? p)
    .sort((a, b) => a.localeCompare(b));
}

// Ignore macOS system listeners that are never interesting dev servers.
const SYSTEM_PROCS = new Set(['ControlCe', 'rapportd', 'sharingd', 'identitys']);

export function parseDevServers(stdout: string, forwardedPorts: Set<number>): DevServer[] {
  const seen = new Map<number, DevServer>();
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [command, addr] = trimmed.split(/\s+/);
    if (!addr || SYSTEM_PROCS.has(command)) continue;
    const port = Number(addr.slice(addr.lastIndexOf(':') + 1));
    if (!Number.isInteger(port) || port < 1) continue;
    if (port === RIG.cdpPort) continue; // the agent's Chrome CDP, not a dev server
    if (!seen.has(port)) {
      seen.set(port, { command, port, forwarded: forwardedPorts.has(port) });
    }
  }
  return [...seen.values()].sort((a, b) => a.port - b.port);
}

export function parseChrome(stdout: string): ChromeHealth {
  if (stdout.includes('NOT_LOADED')) return { loaded: false, running: false, pid: null };
  const state = stdout.match(/state\s*=\s*(\w+)/)?.[1] ?? null;
  const pidMatch = stdout.match(/pid\s*=\s*(\d+)/)?.[1];
  return {
    loaded: true,
    running: state === 'running',
    pid: pidMatch ? Number(pidMatch) : null,
  };
}

// --- local tunnel inspection ---------------------------------------------
const TUNNEL_RE = /-L\s+(\d+):localhost:(\d+)/;

export async function listTunnels(): Promise<TunnelInfo[]> {
  let out = '';
  try {
    const { stdout } = await pexec('pgrep', ['-fl', 'ssh -f -N -L'], { timeout: 4000 });
    out = stdout;
  } catch {
    // pgrep exits non-zero when nothing matches; that just means no tunnels.
    return [];
  }
  const tunnels: TunnelInfo[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(TUNNEL_RE);
    if (!m) continue;
    const localPort = Number(m[1]);
    const remotePort = Number(m[2]);
    tunnels.push({
      kind: localPort === RIG.vncLocalPort ? 'vnc' : 'dev-port',
      localPort,
      remotePort,
      up: true,
    });
  }
  return tunnels;
}

// --- aggregate status -----------------------------------------------------
const SESSIONS_FMT = `${PATH_PREFIX} tmux list-sessions -F '#{session_name}|#{session_attached}|#{session_activity}|#{session_created}' 2>/dev/null || true`;

export async function listSessions(): Promise<SessionInfo[]> {
  return parseSessions(await sshRead(SESSIONS_FMT), Math.floor(Date.now() / 1000));
}

export async function getStatus(): Promise<RigStatus> {
  const tunnels = await listTunnels();
  const forwardedPorts = new Set(
    tunnels.filter((t) => t.kind === 'dev-port').map((t) => t.remotePort),
  );

  const [sessions, devServers, chrome] = await Promise.all([
    listSessions(),
    sshRead(`lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $1" "$9}' | sort -u`).then(
      (o) => parseDevServers(o, forwardedPorts),
    ),
    sshRead(
      `launchctl print gui/$(id -u)/${assertSafe(RIG.chromeLabel, SAFE_LABEL_RE, 'chrome label')} 2>/dev/null | grep -E 'state = |pid = ' || echo NOT_LOADED`,
    ).then(parseChrome),
  ]);

  return {
    sessions,
    tunnels,
    devServers,
    chrome,
    reachable: true,
    error: null,
    fetchedAt: Date.now(),
  };
}

// A relative path under CODE_ROOT, validated segment-by-segment so it can never
// escape the root (no `..`) or inject into the remote shell command.
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

export function assertRelPath(rel: string): string {
  const norm = rel.replace(/^\/+|\/+$/g, '');
  if (norm === '') return '';
  const segments = norm.split('/');
  for (const seg of segments) {
    if (seg === '.' || seg === '..' || !SEGMENT_RE.test(seg)) {
      throw new Error(`Unsafe path: ${JSON.stringify(rel)}`);
    }
  }
  return segments.join('/');
}

function absDir(rel: string): string {
  const codeRoot = assertSafe(RIG.codeRoot, SAFE_PATH_RE, 'code root');
  return rel ? `${codeRoot}/${rel}` : codeRoot;
}

// List immediate subdirectories of CODE_ROOT/<rel> (dotfiles excluded by the glob).
export async function listDirs(rel: string): Promise<string[]> {
  const safe = assertRelPath(rel);
  const out = await sshRead(`ls -1d ${absDir(safe)}/*/ 2>/dev/null || true`);
  return parseDirListing(out);
}

// Just the session names — cheaper than a full getStatus() when all we need is
// the collision set for naming a new session.
async function listSessionNames(): Promise<Set<string>> {
  const out = await sshRead(
    `${PATH_PREFIX} tmux list-sessions -F '#{session_name}' 2>/dev/null || true`,
  );
  return new Set(
    out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  );
}

// --- actions --------------------------------------------------------------
// The local cmux daemon validates our `--password` against automation.socketPassword
// in this file. cmux can rewrite the file and drop the field, leaving password mode
// enabled with nothing to match — then every workspace create fails with "Password
// mode is enabled but no socket password is configured". Keep the two in sync.
const CMUX_CONFIG_PATH = join(homedir(), '.config', 'cmux', 'cmux.json');

// Best-effort: heal the cmux config so it can't silently drift out from under us.
// Only rewrites + reloads when the stored value actually differs, and never throws —
// if healing fails, the workspace create below surfaces the real error.
async function ensureCmuxSocketAuth(): Promise<void> {
  if (!RIG.cmuxSocketPassword) return;
  try {
    const raw = await readFile(CMUX_CONFIG_PATH, 'utf8');
    const cfg = JSON.parse(raw);
    cfg.automation ??= {};
    const automation = cfg.automation;
    if (
      automation.socketControlMode === 'password' &&
      automation.socketPassword === RIG.cmuxSocketPassword
    ) {
      return; // already in sync
    }
    automation.socketControlMode = 'password';
    automation.socketPassword = RIG.cmuxSocketPassword;
    await copyFile(CMUX_CONFIG_PATH, `${CMUX_CONFIG_PATH}.mc.bak`);
    await writeFile(CMUX_CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`);
    // Control commands read socketPassword from disk live, so the write above is
    // the actual cure; this reload just refreshes the daemon's in-memory settings.
    // reload-config is auth-exempt when disk holds a valid password, so no creds.
    await pexec(RIG.cmuxBin, ['reload-config'], { timeout: 5000 });
  } catch {
    // best-effort; let the workspace create surface any real failure
  }
}

// Open an interactive command in a new cmux workspace titled `title`. cmux runs
// `command` in the workspace's terminal, so the remote ssh/tmux session is fully
// interactive. `command` and `title` are passed as argv (no shell on our side).
async function openInCmux(command: string, title: string): Promise<void> {
  await ensureCmuxSocketAuth();
  // `--password` is a global flag and must precede the subcommand. cmux rejects
  // out-of-tree clients (the launchd service) unless they present this secret.
  const auth = RIG.cmuxSocketPassword ? ['--password', RIG.cmuxSocketPassword] : [];
  await pexec(
    RIG.cmuxBin,
    [...auth, 'workspace', 'create', '--name', title, '--command', command],
    { timeout: 8000, env: { ...process.env, CMUX_QUIET: '1' } },
  );
}

export async function attachSession(name: string): Promise<void> {
  assertName(name, 'session name');
  if (!(await listSessionNames()).has(name)) {
    throw new Error(`No such session: ${name}`);
  }
  const remote = `ssh -t ${RIG.sshAlias} "zsh -lic 'tmux attach -t ${name}'"`;
  await openInCmux(remote, name);
}

const LAUNCHER: Record<AgentType, string> = { cc: 'cct', cx: 'cxt', sh: 'tmt' };

// Drop a redundant leading type prefix so an explicit "cc-foo" or a gemma slug
// like "cc-foo" doesn't become "cc-cc-foo".
export function stripTypePrefix(slug: string): string {
  return slug.replace(/^(cc|cx|sh)-/, '');
}

export async function newSession(
  type: AgentType,
  dir: string,
  task = '',
  name = '',
): Promise<string> {
  const rel = assertRelPath(dir);
  // Validate the absolute path before interpolating it unquoted into the launcher.
  const target = assertSafe(absDir(rel), SAFE_PATH_RE, 'working dir');
  const label = rel ? (rel.split('/').pop() as string) : 'code';

  // An explicit name always wins. Only when it's blank does local gemma name the
  // session from the directory + task; that itself falls back to the directory
  // name if ollama is unavailable, so launch never hangs.
  const explicit = slugify(name);
  const slug = stripTypePrefix(explicit || (await generateSessionSlug(label, task)) || label);
  const existing = await listSessionNames();
  const base = `${type}-${slug}`;
  let sessionName = base;
  let n = 2;
  while (existing.has(sessionName)) sessionName = `${base}-${n++}`;
  assertName(sessionName, 'session name');

  // Use the rig launchers (single source of truth) with the -C working-dir flag.
  // The launchers prepend the type themselves (`cct` makes `cc-$n`), so pass the
  // name without our `${type}-` prefix — otherwise the session is doubled
  // (`cc-cc-…`). stripTypePrefix(sessionName) is exactly that suffix, so the
  // launcher reconstructs `sessionName`.
  const launcherName = stripTypePrefix(sessionName);
  const remote = `ssh -t ${RIG.sshAlias} "zsh -lic '${LAUNCHER[type]} -C ${target} ${launcherName}'"`;
  await openInCmux(remote, sessionName);
  return sessionName;
}

export async function killSession(name: string): Promise<void> {
  assertName(name, 'session name');
  if (!(await listSessionNames()).has(name)) {
    throw new Error(`No such session: ${name}`);
  }
  await sshRead(`${PATH_PREFIX} tmux kill-session -t ${name} 2>&1 || true`);
}

export async function renameSession(from: string, to: string): Promise<void> {
  assertName(from, 'session name');
  assertName(to, 'new name');
  const names = await listSessionNames();
  if (!names.has(from)) throw new Error(`No such session: ${from}`);
  if (from !== to && names.has(to)) throw new Error(`Name already taken: ${to}`);
  await sshRead(`${PATH_PREFIX} tmux rename-session -t ${from} ${to} 2>&1 || true`);
}

export async function startScreenshare(): Promise<void> {
  const up = await isPortOpen(RIG.vncLocalPort);
  if (!up) {
    await pexec(
      'ssh',
      ['-f', '-N', '-L', `${RIG.vncLocalPort}:localhost:${RIG.vncRemotePort}`, RIG.sshAlias],
      { timeout: 9000 },
    );
  }
  await pexec('open', [`vnc://localhost:${RIG.vncLocalPort}`], { timeout: 5000 });
}

export async function forwardPort(port: number): Promise<void> {
  assertPort(port);
  const url = `http://localhost:${port}/`;
  if (!(await httpOk(url))) {
    await killTunnel(port);
    await pexec('ssh', ['-f', '-N', '-L', `${port}:localhost:${port}`, RIG.sshAlias], {
      timeout: 9000,
    });
    for (let i = 0; i < 10; i++) {
      if (await httpOk(url)) break;
      await delay(300);
    }
  }
  await pexec('open', [url], { timeout: 5000 });
}

export async function unforwardPort(port: number): Promise<void> {
  assertPort(port);
  await killTunnel(port);
}

// --- local helpers --------------------------------------------------------
async function killTunnel(port: number): Promise<void> {
  try {
    await pexec('pkill', ['-f', `ssh -f -N -L ${port}:localhost:${port} ${RIG.sshAlias}`], {
      timeout: 4000,
    });
  } catch {
    // pkill exits non-zero when nothing matched — fine.
  }
}

async function isPortOpen(port: number): Promise<boolean> {
  try {
    await pexec('nc', ['-z', '127.0.0.1', String(port)], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function httpOk(url: string): Promise<boolean> {
  try {
    await pexec('curl', ['-sS', '-m', '2', '-o', '/dev/null', url], { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
