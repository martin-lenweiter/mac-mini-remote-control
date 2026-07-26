import { describe, expect, it, vi } from 'vitest';
import { openSoftwareUpdate } from '@/lib/rig';
import type { ActionResult } from '@/lib/types';
import { POST } from './route';

vi.mock('@/lib/rig', () => ({ openSoftwareUpdate: vi.fn() }));

describe('POST /api/software-update', () => {
  it('opens the native Software Update flow', async () => {
    vi.mocked(openSoftwareUpdate).mockResolvedValueOnce();

    const response = await POST();
    const body = (await response.json()) as ActionResult;

    expect(openSoftwareUpdate).toHaveBeenCalledOnce();
    expect(body).toEqual({ ok: true, message: 'Opening Software Update on the mini' });
  });

  it('returns an actionable failure', async () => {
    vi.mocked(openSoftwareUpdate).mockRejectedValueOnce(new Error('Mini unavailable'));

    const response = await POST();
    const body = (await response.json()) as ActionResult;

    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, message: 'Mini unavailable' });
  });
});
