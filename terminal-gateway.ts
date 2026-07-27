import { RIG } from './lib/config';
import {
  isSafeTerminalRelativePath,
  readTerminalSecret,
  type TerminalTicket,
  verifyTerminalTicket,
} from './lib/terminal-ticket';

const PORT = Number(process.env.MISSION_CONTROL_TERMINAL_PORT ?? 4322);
const MAX_BUFFERED_BYTES = 1024 * 1024;
const SAFE_NAME_RE = /^[A-Za-z0-9._-]+$/;
const SAFE_PATH_RE = /^[~A-Za-z0-9._/-]+$/;
const LAUNCHER = { cc: 'cct', cx: 'cxt', sh: 'tmt' } as const;
const secret = readTerminalSecret();
const usedNonces = new Map<string, number>();

interface GatewayData {
  ticket: TerminalTicket;
  terminal: Bun.Terminal | null;
  process: Bun.Subprocess | null;
}

interface InputMessage {
  type: 'input';
  data: string;
}

interface ResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

function allowedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === 'http:' &&
      parsed.port === '4321' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

function remoteCommand(ticket: TerminalTicket): string {
  if (!SAFE_NAME_RE.test(ticket.sessionName)) throw new Error('Unsafe session name');
  if (ticket.kind === 'attach') {
    return `export PATH=/opt/homebrew/bin:$HOME/.local/bin:$PATH; exec tmux attach-session -t ${ticket.sessionName}`;
  }

  if (!SAFE_PATH_RE.test(RIG.codeRoot) || !isSafeTerminalRelativePath(ticket.dir)) {
    throw new Error('Unsafe working directory');
  }
  const directory = ticket.dir ? `${RIG.codeRoot}/${ticket.dir}` : RIG.codeRoot;
  const suffix = ticket.sessionName.replace(/^(cc|cx|sh)-/, '');
  if (!SAFE_NAME_RE.test(suffix)) throw new Error('Unsafe launcher name');
  return `zsh -lic '${LAUNCHER[ticket.type]} -C ${directory} ${suffix}'`;
}

function parseClientMessage(raw: string): InputMessage | ResizeMessage | null {
  if (raw.length > 65_536) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (
    message.type === 'input' &&
    typeof message.data === 'string' &&
    message.data.length <= 65_536
  ) {
    return { type: 'input', data: message.data };
  }
  if (
    message.type === 'resize' &&
    Number.isInteger(message.cols) &&
    Number.isInteger(message.rows) &&
    Number(message.cols) >= 2 &&
    Number(message.cols) <= 500 &&
    Number(message.rows) >= 1 &&
    Number(message.rows) <= 300
  ) {
    return { type: 'resize', cols: Number(message.cols), rows: Number(message.rows) };
  }
  return null;
}

function closeSession(data: GatewayData): void {
  if (data.process && !data.process.killed) data.process.kill('SIGHUP');
  if (data.terminal && !data.terminal.closed) data.terminal.close();
  data.process = null;
  data.terminal = null;
}

const server = Bun.serve<GatewayData>({
  hostname: '127.0.0.1',
  port: PORT,
  maxRequestBodySize: 1024,
  fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');
    if (url.pathname !== '/terminal' || !allowedOrigin(request)) {
      return new Response('Forbidden', { status: 403 });
    }

    const token = url.searchParams.get('ticket');
    if (!token) return new Response('Missing ticket', { status: 401 });

    try {
      const ticket = verifyTerminalTicket(token, secret);
      if (usedNonces.has(ticket.nonce)) return new Response('Ticket already used', { status: 401 });
      const upgraded = server.upgrade(request, {
        data: { ticket, terminal: null, process: null },
      });
      if (!upgraded) return new Response('WebSocket upgrade required', { status: 426 });
      usedNonces.set(ticket.nonce, ticket.exp);
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid ticket';
      return new Response(message, { status: 401 });
    }
  },
  websocket: {
    maxPayloadLength: 65_536,
    perMessageDeflate: false,
    open(ws) {
      try {
        const terminal = new Bun.Terminal({
          cols: 100,
          rows: 30,
          name: 'xterm-256color',
          data(_terminal, output) {
            if (ws.getBufferedAmount() > MAX_BUFFERED_BYTES) {
              ws.close(1013, 'Terminal output backpressure');
              return;
            }
            ws.sendBinary(output);
          },
          exit() {
            ws.close(1000, 'Terminal closed');
          },
        });
        terminal.setRawMode(true);
        const process = Bun.spawn(
          [
            'ssh',
            '-tt',
            '-o',
            'BatchMode=yes',
            '-o',
            `ConnectTimeout=${RIG.connectTimeout}`,
            RIG.sshAlias,
            remoteCommand(ws.data.ticket),
          ],
          {
            terminal,
            env: { ...Bun.env, TERM: 'xterm-256color' },
          },
        );
        ws.data.terminal = terminal;
        ws.data.process = process;
        void process.exited.then(() => {
          if (!terminal.closed) terminal.close();
        });
      } catch (error) {
        ws.close(1011, error instanceof Error ? error.message : 'Could not start terminal');
      }
    },
    message(ws, raw) {
      if (typeof raw !== 'string' || !ws.data.terminal) {
        ws.close(1003, 'Invalid terminal message');
        return;
      }
      const message = parseClientMessage(raw);
      if (!message) {
        ws.close(1003, 'Invalid terminal message');
      } else if (message.type === 'input') {
        ws.data.terminal.write(message.data);
      } else {
        ws.data.terminal.resize(message.cols, message.rows);
      }
    },
    close(ws) {
      closeSession(ws.data);
    },
  },
});

interface AttentionRecord {
  state: 'idle' | 'permission';
  at: number;
}

function parseAttention(stdout: string): Map<string, AttentionRecord> {
  const result = new Map<string, AttentionRecord>();
  for (const line of stdout.split('\n')) {
    const [name, state, atText] = line.trim().split('|');
    const at = Number(atText);
    if (
      SAFE_NAME_RE.test(name ?? '') &&
      (state === 'idle' || state === 'permission') &&
      Number.isSafeInteger(at) &&
      at > 0
    ) {
      result.set(name, { state, at });
    }
  }
  return result;
}

async function readAttention(): Promise<Map<string, AttentionRecord>> {
  const command =
    "export PATH=/opt/homebrew/bin:$PATH; tmux list-sessions -F '#{session_name}|#{@mission-control-attention}|#{@mission-control-attention-at}' 2>/dev/null || true";
  const process = Bun.spawn(
    [
      'ssh',
      '-o',
      'BatchMode=yes',
      '-o',
      `ConnectTimeout=${RIG.connectTimeout}`,
      RIG.sshAlias,
      command,
    ],
    { stdout: 'pipe', stderr: 'ignore' },
  );
  const stdout = await new Response(process.stdout).text();
  if ((await process.exited) !== 0) throw new Error('Attention probe failed');
  return parseAttention(stdout);
}

async function notifyAttention(): Promise<void> {
  const script =
    'on run argv\n display notification (item 1 of argv) with title "Mission Control"\nend run';
  const process = Bun.spawn(
    ['/usr/bin/osascript', '-e', script, '--', 'An agent session needs input'],
    { stdout: 'ignore', stderr: 'ignore' },
  );
  await process.exited;
}

let attentionBaseline: Map<string, AttentionRecord> | null = null;
let pollRunning = false;

async function pollAttention(): Promise<void> {
  if (pollRunning) return;
  pollRunning = true;
  try {
    const current = await readAttention();
    if (attentionBaseline) {
      for (const [name, record] of current) {
        const previous = attentionBaseline.get(name);
        if (previous?.at !== record.at || previous.state !== record.state) await notifyAttention();
      }
    }
    attentionBaseline = current;
  } catch {
    // The dashboard already reports mini reachability. Notification polling is
    // best-effort and resumes automatically after the next successful probe.
  } finally {
    pollRunning = false;
    const now = Date.now();
    for (const [nonce, expiresAt] of usedNonces) {
      if (expiresAt < now) usedNonces.delete(nonce);
    }
  }
}

void pollAttention();
setInterval(() => void pollAttention(), 4_000);

console.log(`Mission Control terminal gateway listening on ${server.url}`);
