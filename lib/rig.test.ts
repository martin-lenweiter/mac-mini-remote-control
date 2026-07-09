import { describe, expect, it } from 'vitest';
import {
  assertRelPath,
  parseChrome,
  parseDevServers,
  parseDirListing,
  parseSessions,
  stripTypePrefix,
} from '@/lib/rig';

describe('parseSessions', () => {
  const now = 1_000_000;

  it('parses fields, classifies type, and computes idle', () => {
    const out = [
      `cc-fix-bug|1|${now - 30}|${now - 300}`,
      `cx-1782777489|0|${now - 120}|${now - 600}`,
      `sh-work|0|${now - 7200}|${now - 9000}`,
    ].join('\n');
    const sessions = parseSessions(out, now);

    const byName = Object.fromEntries(sessions.map((s) => [s.name, s]));
    expect(byName['cc-fix-bug']).toMatchObject({ type: 'cc', attached: true, idleSeconds: 30 });
    expect(byName['cc-fix-bug'].ephemeral).toBe(false);
    expect(byName['cx-1782777489']).toMatchObject({ type: 'cx', attached: false });
    expect(byName['cx-1782777489'].ephemeral).toBe(true);
    expect(byName['sh-work'].type).toBe('sh');
  });

  it('marks non-prefixed sessions as other and ignores blank lines', () => {
    const sessions = parseSessions(`hermes-dashboard|0|${now}|${now}\n\n`, now);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].type).toBe('other');
  });

  it('sorts newest first by createdAt', () => {
    const out = [`cc-a|0|${now}|100`, `cc-b|0|${now}|900`].join('\n');
    expect(parseSessions(out, now).map((s) => s.name)).toEqual(['cc-b', 'cc-a']);
  });

  it('skips malformed lines that lack the 4 pipe-separated fields', () => {
    const out = [
      'no such file or directory', // stray error, no pipes
      `cc-good|1|${now}|${now - 10}`,
      'partial|0', // too few fields
    ].join('\n');
    const sessions = parseSessions(out, now);
    expect(sessions.map((s) => s.name)).toEqual(['cc-good']);
  });
});

describe('parseDirListing', () => {
  it('derives basenames, strips trailing slash, sorts', () => {
    const dirs = parseDirListing('/Users/martin/code/hermes/\n/Users/martin/code/grace/\n');
    expect(dirs).toEqual(['grace', 'hermes']);
  });
});

describe('stripTypePrefix', () => {
  it('drops a redundant leading type prefix', () => {
    expect(stripTypePrefix('cc-text-size')).toBe('text-size');
    expect(stripTypePrefix('sh-build')).toBe('build');
  });

  it('leaves slugs without a type prefix untouched', () => {
    expect(stripTypePrefix('text-size')).toBe('text-size');
    expect(stripTypePrefix('hermes')).toBe('hermes');
  });

  // newSession passes stripTypePrefix(sessionName) to the launcher, which
  // re-adds the type prefix. This round-trip must reproduce sessionName exactly,
  // or sessions get a doubled prefix (cc-cc-…) that desyncs attach/kill.
  it('round-trips with the launcher prefix for every type', () => {
    for (const [type, name] of [
      ['cc', 'cc-fix-bug'],
      ['cx', 'cx-fix-bug-2'],
      ['sh', 'sh-cc-named-like-a-type'],
    ] as const) {
      expect(`${type}-${stripTypePrefix(name)}`).toBe(name);
    }
  });
});

describe('assertRelPath', () => {
  it('normalizes valid relative paths', () => {
    expect(assertRelPath('')).toBe('');
    expect(assertRelPath('/hermes/')).toBe('hermes');
    expect(assertRelPath('hermes/packages/core')).toBe('hermes/packages/core');
  });

  it('rejects traversal and shell metacharacters', () => {
    expect(() => assertRelPath('../etc')).toThrow();
    expect(() => assertRelPath('a/../b')).toThrow();
    expect(() => assertRelPath('a; rm -rf')).toThrow();
    expect(() => assertRelPath('a/$(whoami)')).toThrow();
  });
});

describe('parseDevServers', () => {
  it('extracts ports, dedupes, drops system procs and the CDP port', () => {
    const out = [
      'node *:3000',
      'node *:3000',
      'python3.1 127.0.0.1:8000',
      'Google 127.0.0.1:9335', // CDP — excluded
      'ControlCe *:5000', // system — excluded
      'postgres [::1]:5432',
    ].join('\n');
    const servers = parseDevServers(out, new Set([8000]));
    expect(servers.map((s) => s.port)).toEqual([3000, 5432, 8000]);
    expect(servers.find((s) => s.port === 8000)?.forwarded).toBe(true);
    expect(servers.find((s) => s.port === 3000)?.forwarded).toBe(false);
  });
});

describe('parseChrome', () => {
  it('reads running state and pid', () => {
    expect(parseChrome('\tstate = running\n\tpid = 66720\n')).toEqual({
      loaded: true,
      running: true,
      pid: 66720,
    });
  });

  it('handles stopped and not-loaded', () => {
    expect(parseChrome('\tstate = waiting\n')).toMatchObject({ loaded: true, running: false });
    expect(parseChrome('NOT_LOADED')).toEqual({ loaded: false, running: false, pid: null });
  });
});
