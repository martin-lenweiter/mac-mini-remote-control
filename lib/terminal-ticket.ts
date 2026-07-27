import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentType } from '@/lib/types';

const NAME_RE = /^[A-Za-z0-9._-]+$/;
const REL_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const TICKET_TTL_MS = 30_000;

interface TicketBase {
  exp: number;
  nonce: string;
  sessionName: string;
}

export interface AttachTicket extends TicketBase {
  kind: 'attach';
}

export interface LaunchTicket extends TicketBase {
  kind: 'launch';
  type: AgentType;
  dir: string;
}

export type TerminalTicket = AttachTicket | LaunchTicket;

function encode(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function signature(payload: string, secret: string): string {
  return encode(createHmac('sha256', secret).update(payload).digest());
}

function isAgentType(value: unknown): value is AgentType {
  return value === 'cc' || value === 'cx' || value === 'sh';
}

export function isSafeTerminalRelativePath(value: string): boolean {
  return (
    value === '' ||
    value
      .split('/')
      .every((segment) => segment !== '.' && segment !== '..' && REL_SEGMENT_RE.test(segment))
  );
}

function isTicket(value: unknown): value is TerminalTicket {
  if (!value || typeof value !== 'object') return false;
  const ticket = value as Record<string, unknown>;
  if (
    !NAME_RE.test(String(ticket.sessionName ?? '')) ||
    !Number.isSafeInteger(ticket.exp) ||
    typeof ticket.nonce !== 'string' ||
    !/^[a-f0-9]{32}$/.test(ticket.nonce)
  ) {
    return false;
  }
  if (ticket.kind === 'attach') return true;
  return (
    ticket.kind === 'launch' &&
    isAgentType(ticket.type) &&
    typeof ticket.dir === 'string' &&
    isSafeTerminalRelativePath(ticket.dir)
  );
}

export function signTerminalTicket(
  input:
    | { kind: 'attach'; sessionName: string }
    | { kind: 'launch'; sessionName: string; type: AgentType; dir: string },
  secret: string,
  now = Date.now(),
): string {
  const ticket = {
    ...input,
    exp: now + TICKET_TTL_MS,
    nonce: randomBytes(16).toString('hex'),
  } satisfies TerminalTicket;
  if (!isTicket(ticket)) throw new Error('Invalid terminal ticket payload');
  const payload = encode(JSON.stringify(ticket));
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyTerminalTicket(
  token: string,
  secret: string,
  now = Date.now(),
): TerminalTicket {
  const [payload, suppliedSignature, extra] = token.split('.');
  if (!payload || !suppliedSignature || extra) throw new Error('Malformed terminal ticket');

  const expected = Buffer.from(signature(payload, secret));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new Error('Invalid terminal ticket');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Malformed terminal ticket');
  }
  if (!isTicket(decoded)) throw new Error('Invalid terminal ticket payload');
  if (decoded.exp < now) throw new Error('Expired terminal ticket');
  return decoded;
}

export function readTerminalSecret(): string {
  const path =
    process.env.MISSION_CONTROL_TERMINAL_SECRET_FILE ??
    join(/* turbopackIgnore: true */ homedir(), '.local/state/mission-control/terminal-secret');
  const secret = readFileSync(/* turbopackIgnore: true */ path, 'utf8').trim();
  if (secret.length < 32) throw new Error('Terminal gateway secret is missing or invalid');
  return secret;
}

export function createTerminalTicket(
  input:
    | { kind: 'attach'; sessionName: string }
    | { kind: 'launch'; sessionName: string; type: AgentType; dir: string },
): string {
  return signTerminalTicket(input, readTerminalSecret());
}
