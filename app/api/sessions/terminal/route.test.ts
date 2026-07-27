import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertSessionExists } from '@/lib/rig';
import { createTerminalTicket } from '@/lib/terminal-ticket';
import type { TerminalActionResult } from '@/lib/types';
import { POST } from './route';

vi.mock('@/lib/rig', () => ({ assertSessionExists: vi.fn() }));
vi.mock('@/lib/terminal-ticket', () => ({ createTerminalTicket: vi.fn() }));

describe('POST /api/sessions/terminal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('issues an attach ticket only for a live session', async () => {
    vi.mocked(assertSessionExists).mockResolvedValueOnce();
    vi.mocked(createTerminalTicket).mockReturnValueOnce('signed-ticket');
    const request = new NextRequest('http://localhost/api/sessions/terminal', {
      method: 'POST',
      body: JSON.stringify({ name: 'cx-review' }),
    });

    const body = (await (await POST(request)).json()) as TerminalActionResult;

    expect(assertSessionExists).toHaveBeenCalledWith('cx-review');
    expect(createTerminalTicket).toHaveBeenCalledWith({
      kind: 'attach',
      sessionName: 'cx-review',
    });
    expect(body.terminal).toEqual({ sessionName: 'cx-review', ticket: 'signed-ticket' });
  });

  it('does not mint a ticket when the session is gone', async () => {
    vi.mocked(assertSessionExists).mockRejectedValueOnce(new Error('No such session: cx-gone'));
    const request = new NextRequest('http://localhost/api/sessions/terminal', {
      method: 'POST',
      body: JSON.stringify({ name: 'cx-gone' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(500);
    expect(createTerminalTicket).not.toHaveBeenCalled();
  });
});
