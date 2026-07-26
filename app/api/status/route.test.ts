import { describe, expect, it, vi } from 'vitest';
import { getStatus } from '@/lib/rig';
import type { RigStatus } from '@/lib/types';
import { GET } from './route';

vi.mock('@/lib/rig', () => ({ getStatus: vi.fn() }));

const ONLINE: RigStatus = {
  sessions: [],
  tunnels: [],
  devServers: [],
  health: null,
  reachable: true,
  error: null,
  fetchedAt: 1,
};

describe('GET /api/status', () => {
  it('passes through a reachable status', async () => {
    vi.mocked(getStatus).mockResolvedValueOnce(ONLINE);
    const body = (await (await GET()).json()) as RigStatus;
    expect(body.reachable).toBe(true);
    expect(body.health).toBeNull();
  });

  it('returns an offline fallback when the probe throws', async () => {
    vi.mocked(getStatus).mockRejectedValueOnce(new Error('ssh: connect to host timed out'));
    const body = (await (await GET()).json()) as RigStatus;
    expect(body.reachable).toBe(false);
    expect(body.error).toContain('ssh');
    expect(body.sessions).toEqual([]);
  });
});
