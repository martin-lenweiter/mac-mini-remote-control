import { describe, expect, it } from 'vitest';
import {
  isSafeTerminalRelativePath,
  signTerminalTicket,
  verifyTerminalTicket,
} from '@/lib/terminal-ticket';

const SECRET = 'a-secure-test-secret-that-is-long-enough';

describe('terminal tickets', () => {
  it('round-trips a short-lived attach ticket', () => {
    const token = signTerminalTicket({ kind: 'attach', sessionName: 'cx-fix-bug' }, SECRET, 1_000);
    expect(verifyTerminalTicket(token, SECRET, 2_000)).toMatchObject({
      kind: 'attach',
      sessionName: 'cx-fix-bug',
      exp: 31_000,
    });
  });

  it('round-trips a validated launch ticket', () => {
    const token = signTerminalTicket(
      { kind: 'launch', sessionName: 'cc-login', type: 'cc', dir: 'apps/web' },
      SECRET,
      1_000,
    );
    expect(verifyTerminalTicket(token, SECRET, 2_000)).toMatchObject({
      kind: 'launch',
      sessionName: 'cc-login',
      type: 'cc',
      dir: 'apps/web',
    });
  });

  it('rejects tampering, expiration, and shell metacharacters', () => {
    const token = signTerminalTicket({ kind: 'attach', sessionName: 'cx-safe' }, SECRET, 1_000);
    expect(() => verifyTerminalTicket(`${token}x`, SECRET, 2_000)).toThrow('Invalid');
    expect(() => verifyTerminalTicket(token, SECRET, 31_001)).toThrow('Expired');
    expect(() =>
      signTerminalTicket(
        { kind: 'launch', sessionName: 'cc-bad', type: 'cc', dir: 'repo;reboot' },
        SECRET,
      ),
    ).toThrow('Invalid terminal ticket payload');
  });

  it('accepts the code root and nested safe paths', () => {
    expect(isSafeTerminalRelativePath('')).toBe(true);
    expect(isSafeTerminalRelativePath('apps/web')).toBe(true);
    expect(isSafeTerminalRelativePath('../private')).toBe(false);
  });
});
