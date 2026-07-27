import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RIG } from '@/lib/config';
import { generateSessionSlug, slugify } from '@/lib/naming';
import type {
  AgentType,
  DevServer,
  MemoryPressure,
  MiniHealth,
  OSUpdateStatus,
  RigStatus,
  SessionInfo,
  TunnelInfo,
} from '@/lib/types';

const pexec = promisify(execFile);

interface CmuxReadinessActions {
  ping: () => Promise<void>;
  launch: () => Promise<void>;
  wait: () => Promise<void>;
}

export async function waitForCmuxReady(
  { ping, launch, wait }: CmuxReadinessActions,
  attempts: number,
): Promise<void> {
  try {
    await ping();
    return;
  } catch {
    await launch();
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await ping();
      return;
    } catch {
      if (attempt < attempts - 1) await wait();
    }
  }

  throw new Error(
    'cmux did not become ready after launch. Check cmux Settings → Automation and try again.',
  );
}

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
function assertSafe(value: string, re: RegExp, label: string): string {
  if (!re.test(value)) throw new Error(`Unsafe ${label}: ${JSON.stringify(value)}`);
  return value;
}

const PANE_TTY_RE = /^\/dev\/ttys[0-9a-f]+$/i;

export function parsePaneTargets(stdout: string): Array<{ pid: number; tty: string }> {
  const targets = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pidText, tty] = line.split('|');
      const pid = Number(pidText);
      if (!Number.isInteger(pid) || pid < 1 || !tty || !PANE_TTY_RE.test(tty)) {
        throw new Error(`Invalid tmux pane target: ${JSON.stringify(line)}`);
      }
      return { pid, tty };
    });
  if (targets.length === 0) throw new Error('Session has no live panes');
  return targets;
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
        attention: parts[4] === 'idle' || parts[4] === 'permission' ? parts[4] : null,
        attentionAt: Number(parts[5]) > 0 ? Number(parts[5]) : null,
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

function parseByteSize(value: string): number {
  const match = value.match(/^([\d.]+)([BKMGT])$/i);
  if (!match) return Number.NaN;
  const power = 'BKMGT'.indexOf(match[2].toUpperCase());
  return Number(match[1]) * 1024 ** power;
}

function parseMemoryPressure(value: number): MemoryPressure {
  if (value === 1) return 'normal';
  if (value === 2) return 'warning';
  if (value === 4) return 'critical';
  throw new Error(`Unknown mini memory pressure level: ${value}`);
}

export function parseMiniHealth(stdout: string): Omit<MiniHealth, 'osUpdate'> {
  const idle = Number(stdout.match(/CPU usage:.*?([\d.]+)% idle/)?.[1]);
  const memory = stdout.match(/PhysMem:\s*([\d.]+[BKMGT]) used.*?([\d.]+[BKMGT]) unused/i);
  const memoryTotal = Number(stdout.match(/^MEMTOTAL\s+(\d+)$/m)?.[1]);
  const memoryPressure = Number(stdout.match(/^MEMORYPRESSURE\s+(\d+)$/m)?.[1]);
  const disk = stdout.match(/^DISK\s+(\d+)\s+(\d+)$/m);
  const diskTotal = Number(disk?.[1]);
  const diskFree = Number(disk?.[2]);
  const bootTime = Number(stdout.match(/^BOOT\s+(\d+)$/m)?.[1]);
  const now = Number(stdout.match(/^NOW\s+(\d+)$/m)?.[1]);
  const osVersion = stdout.match(/^OS\s+(\S+)$/m)?.[1] ?? '';

  if (
    !Number.isFinite(idle) ||
    !memory ||
    !Number.isFinite(memoryTotal) ||
    !Number.isFinite(memoryPressure) ||
    !Number.isFinite(diskTotal) ||
    diskTotal <= 0 ||
    !Number.isFinite(diskFree) ||
    diskFree < 0 ||
    diskFree > diskTotal ||
    !Number.isFinite(bootTime) ||
    !Number.isFinite(now) ||
    !osVersion
  ) {
    throw new Error('Could not parse mini health probe');
  }

  const unusedBytes = parseByteSize(memory[2]);
  if (!Number.isFinite(unusedBytes)) throw new Error('Could not parse mini memory usage');

  return {
    cpuUsedPercent: Math.max(0, Math.min(100, 100 - idle)),
    memoryUsedBytes: Math.max(0, memoryTotal - unusedBytes),
    memoryTotalBytes: memoryTotal,
    memoryPressure: parseMemoryPressure(memoryPressure),
    diskUsedPercent: Math.round(((diskTotal - diskFree) / diskTotal) * 100),
    uptimeSeconds: Math.max(0, now - bootTime),
    osVersion,
  };
}

export function parseOSUpdate(stdout: string, checkedAt: number): OSUpdateStatus {
  const match = stdout.match(/Title:\s*macOS [^,\n]+,\s*Version:\s*([^,\n]+)/i);
  return {
    available: match !== null,
    version: match?.[1]?.trim() ?? null,
    checkedAt,
    error: null,
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
const SESSIONS_FMT = `${PATH_PREFIX} tmux list-sessions -F '#{session_name}|#{session_attached}|#{session_activity}|#{session_created}|#{@mission-control-attention}|#{@mission-control-attention-at}' 2>/dev/null || true`;
const HEALTH_CMD = [
  `top -l 1 -n 0 | grep -E '^(CPU usage|PhysMem):'`,
  `sysctl -n hw.memsize | awk '{print "MEMTOTAL "$1}'`,
  `sysctl -n kern.memorystatus_vm_pressure_level | awk '{print "MEMORYPRESSURE "$1}'`,
  `disk_info="$(diskutil info -plist /)"; disk_total="$(printf '%s' "$disk_info" | plutil -extract APFSContainerSize raw -)"; disk_free="$(printf '%s' "$disk_info" | plutil -extract APFSContainerFree raw -)"; printf 'DISK %s %s\\n' "$disk_total" "$disk_free"`,
  `sysctl -n kern.boottime | awk -F'[=,]' '{gsub(/ /, "", $2); print "BOOT "$2}'`,
  `date +%s | awk '{print "NOW "$1}'`,
  `sw_vers -productVersion | awk '{print "OS "$1}'`,
].join('; ');
const UPDATE_CACHE_MS = 30 * 60 * 1000;

let updateCache: { value: OSUpdateStatus; expiresAt: number } | null = null;

async function getOSUpdate(): Promise<OSUpdateStatus> {
  const now = Date.now();
  if (updateCache && updateCache.expiresAt > now) return updateCache.value;

  let value: OSUpdateStatus;
  try {
    value = parseOSUpdate(await sshRead('softwareupdate --list 2>&1', 30_000), now);
  } catch (error) {
    value = {
      available: false,
      version: null,
      checkedAt: now,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  updateCache = { value, expiresAt: now + UPDATE_CACHE_MS };
  return value;
}

export async function listSessions(): Promise<SessionInfo[]> {
  return parseSessions(await sshRead(SESSIONS_FMT), Math.floor(Date.now() / 1000));
}

export async function getStatus(): Promise<RigStatus> {
  const tunnels = await listTunnels();
  const forwardedPorts = new Set(
    tunnels.filter((t) => t.kind === 'dev-port').map((t) => t.remotePort),
  );

  const [sessions, devServers, healthBase, osUpdate] = await Promise.all([
    listSessions(),
    sshRead(`lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $1" "$9}' | sort -u`).then(
      (o) => parseDevServers(o, forwardedPorts),
    ),
    sshRead(HEALTH_CMD).then(parseMiniHealth),
    getOSUpdate(),
  ]);

  return {
    sessions,
    tunnels,
    devServers,
    health: { ...healthBase, osUpdate },
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

export async function assertSessionExists(name: string): Promise<void> {
  assertName(name, 'session name');
  if (!(await listSessionNames()).has(name)) {
    throw new Error(`No such session: ${name}`);
  }
}

// --- actions --------------------------------------------------------------
const CMUX_READY_ATTEMPTS = 24;
const CMUX_READY_INTERVAL_MS = 100;
const CMUX_PING_TIMEOUT_MS = 250;
let cmuxReadyPromise: Promise<void> | null = null;

async function ensureCmuxReady(): Promise<void> {
  if (!cmuxReadyPromise) {
    const env = { ...process.env, CMUX_QUIET: '1' };
    cmuxReadyPromise = waitForCmuxReady(
      {
        ping: async () => {
          await pexec(RIG.cmuxBin, ['ping'], { timeout: CMUX_PING_TIMEOUT_MS, env });
        },
        launch: async () => {
          try {
            await pexec('open', ['-g', '-a', 'cmux'], { timeout: 8000 });
          } catch {
            throw new Error('Unable to launch cmux. Confirm it is installed in Applications.');
          }
        },
        wait: () => delay(CMUX_READY_INTERVAL_MS),
      },
      CMUX_READY_ATTEMPTS,
    ).finally(() => {
      cmuxReadyPromise = null;
    });
  }
  await cmuxReadyPromise;
}

// Open an interactive command in a new cmux workspace titled `title`. cmux runs
// `command` in the workspace's terminal, so the remote ssh/tmux session is fully
// interactive. `command` and `title` are passed as argv (no shell on our side).
async function openInCmux(command: string, title: string): Promise<void> {
  await ensureCmuxReady();
  await pexec(RIG.cmuxBin, ['new-workspace', '--name', title, '--command', command], {
    timeout: 8000,
    env: { ...process.env, CMUX_QUIET: '1' },
  });
}

export async function attachSession(name: string): Promise<void> {
  await assertSessionExists(name);
  const remote = `ssh -t ${RIG.sshAlias} "zsh -lic 'tmux attach -t ${name}'"`;
  await openInCmux(remote, name);
}

// Drop a redundant leading type prefix so an explicit "cc-foo" or a gemma slug
// like "cc-foo" doesn't become "cc-cc-foo".
export function stripTypePrefix(slug: string): string {
  return slug.replace(/^(cc|cx|sh)-/, '');
}

export async function prepareSession(
  type: AgentType,
  dir: string,
  task = '',
  name = '',
): Promise<{ sessionName: string; type: AgentType; dir: string }> {
  const rel = assertRelPath(dir);
  // Validate the absolute path now even though the gateway reconstructs it. This
  // keeps session preparation and launch behind the same path allowlist.
  assertSafe(absDir(rel), SAFE_PATH_RE, 'working dir');
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

  return { sessionName, type, dir: rel };
}

export async function killSession(name: string): Promise<void> {
  await assertSessionExists(name);
  const targets = parsePaneTargets(
    await sshRead(`${PATH_PREFIX} tmux list-panes -s -t ${name} -F '#{pane_pid}|#{pane_tty}'`),
  );
  const checks = targets.map(({ pid, tty }) => {
    const ttyName = tty.slice('/dev/'.length);
    return `test "$(ps -p ${pid} -o tty= | tr -d ' ')" = ${ttyName}`;
  });
  const kills = targets.map(({ tty }) => {
    const ttyName = tty.slice('/dev/'.length);
    return `pkill -KILL -t ${ttyName} '.*' 2>/dev/null || true`;
  });
  await sshRead(
    `${PATH_PREFIX} ${checks.join(' && ')} || { echo 'Pane identity changed; refusing to kill' >&2; exit 1; }; ${kills.join('; ')}; tmux kill-session -t ${name} 2>/dev/null || true`,
  );
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

export async function openSoftwareUpdate(): Promise<void> {
  await sshRead(`open 'x-apple.systempreferences:com.apple.Software-Update-Settings.extension'`);
  await startScreenshare();
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
