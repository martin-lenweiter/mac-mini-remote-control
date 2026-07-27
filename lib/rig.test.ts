import { describe, expect, it } from 'vitest';
import {
  assertRelPath,
  parseDevServers,
  parseDirListing,
  parseMiniHealth,
  parseOSUpdate,
  parsePaneTargets,
  parseSessions,
  stripTypePrefix,
  waitForCmuxReady,
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
    expect(byName['cc-fix-bug'].attention).toBeNull();
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

  it('parses lifecycle attention options when present', () => {
    const out = `cx-review|0|${now - 5}|${now - 100}|permission|${now - 2}`;
    expect(parseSessions(out, now)[0]).toMatchObject({
      attention: 'permission',
      attentionAt: now - 2,
    });
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

describe('waitForCmuxReady', () => {
  it('does not launch cmux when it is already reachable', async () => {
    let launches = 0;
    let waits = 0;

    await waitForCmuxReady(
      {
        ping: async () => {},
        launch: async () => {
          launches += 1;
        },
        wait: async () => {
          waits += 1;
        },
      },
      3,
    );

    expect(launches).toBe(0);
    expect(waits).toBe(0);
  });

  it('launches cmux and waits for its socket to become ready', async () => {
    let pings = 0;
    let launches = 0;
    let waits = 0;

    await waitForCmuxReady(
      {
        ping: async () => {
          pings += 1;
          if (pings < 3) throw new Error('socket missing');
        },
        launch: async () => {
          launches += 1;
        },
        wait: async () => {
          waits += 1;
        },
      },
      3,
    );

    expect(pings).toBe(3);
    expect(launches).toBe(1);
    expect(waits).toBe(1);
  });

  it('returns a safe, actionable error when cmux never becomes ready', async () => {
    await expect(
      waitForCmuxReady(
        {
          ping: async () => {
            throw new Error('command contains a secret');
          },
          launch: async () => {},
          wait: async () => {},
        },
        2,
      ),
    ).rejects.toThrow(
      'cmux did not become ready after launch. Check cmux Settings → Automation and try again.',
    );
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

describe('parsePaneTargets', () => {
  it('accepts numeric pane pids with macOS pseudo terminals', () => {
    expect(parsePaneTargets('24409|/dev/ttys005\n301|/dev/ttys00a\n')).toEqual([
      { pid: 24409, tty: '/dev/ttys005' },
      { pid: 301, tty: '/dev/ttys00a' },
    ]);
  });

  it('fails closed for missing or unsafe pane targets', () => {
    expect(() => parsePaneTargets('')).toThrow('no live panes');
    expect(() => parsePaneTargets('24409|/dev/ttys005;reboot')).toThrow('Invalid');
    expect(() => parsePaneTargets('not-a-pid|/dev/ttys005')).toThrow('Invalid');
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

describe('parseMiniHealth', () => {
  it('parses CPU, memory, disk, uptime, and OS version', () => {
    const out = [
      'CPU usage: 11.78% user, 15.15% sys, 73.6% idle',
      'PhysMem: 14G used (2828M wired), 1318M unused.',
      'MEMTOTAL 17179869184',
      'MEMORYPRESSURE 1',
      'DISK 245107195904 49547091968',
      'BOOT 1000',
      'NOW 3700',
      'OS 26.4.1',
    ].join('\n');

    expect(parseMiniHealth(out)).toEqual({
      cpuUsedPercent: 26.400000000000006,
      memoryUsedBytes: 15797846016,
      memoryTotalBytes: 17179869184,
      memoryPressure: 'normal',
      diskUsedPercent: 80,
      uptimeSeconds: 2700,
      osVersion: '26.4.1',
    });
  });

  it('rejects incomplete probe output', () => {
    expect(() => parseMiniHealth('CPU usage: 100% idle')).toThrow();
  });

  it.each([
    [1, 'normal'],
    [2, 'warning'],
    [4, 'critical'],
  ] as const)('maps kernel memory pressure level %i to %s', (level, expected) => {
    const out = [
      'CPU usage: 100% idle',
      'PhysMem: 14G used, 2G unused.',
      'MEMTOTAL 17179869184',
      `MEMORYPRESSURE ${level}`,
      'DISK 100 20',
      'BOOT 1000',
      'NOW 1001',
      'OS 26.4.1',
    ].join('\n');

    expect(parseMiniHealth(out).memoryPressure).toBe(expected);
  });

  it('rejects an unknown kernel memory pressure level', () => {
    const out = [
      'CPU usage: 100% idle',
      'PhysMem: 14G used, 2G unused.',
      'MEMTOTAL 17179869184',
      'MEMORYPRESSURE 3',
      'DISK 100 20',
      'BOOT 1000',
      'NOW 1001',
      'OS 26.4.1',
    ].join('\n');

    expect(() => parseMiniHealth(out)).toThrow('Unknown mini memory pressure level: 3');
  });
});

describe('parseOSUpdate', () => {
  it('finds a macOS update while ignoring other software', () => {
    const out = [
      '* Label: Command Line Tools for Xcode 26.6-26.6',
      '  Title: Command Line Tools for Xcode 26.6, Version: 26.6, Size: 920431KiB',
      '* Label: macOS Tahoe 26.5.2-25F84',
      '  Title: macOS Tahoe 26.5.2, Version: 26.5.2, Size: 3709215KiB',
    ].join('\n');
    expect(parseOSUpdate(out, 123)).toEqual({
      available: true,
      version: '26.5.2',
      checkedAt: 123,
      error: null,
    });
  });

  it('reports no OS update when only other updates are available', () => {
    expect(parseOSUpdate('Title: Command Line Tools, Version: 26.6', 123)).toMatchObject({
      available: false,
      version: null,
    });
  });
});
