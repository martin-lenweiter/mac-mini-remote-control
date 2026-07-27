import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareSession } from '@/lib/rig';
import { createTerminalTicket } from '@/lib/terminal-ticket';
import type { TerminalActionResult } from '@/lib/types';
import { POST } from './route';

vi.mock('@/lib/rig', () => ({ prepareSession: vi.fn() }));
vi.mock('@/lib/terminal-ticket', () => ({ createTerminalTicket: vi.fn() }));

describe('POST /api/sessions/new', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a launch ticket without opening cmux', async () => {
    vi.mocked(prepareSession).mockResolvedValueOnce({
      sessionName: 'sh-terminal-qa',
      type: 'sh',
      dir: 'side_projects',
    });
    vi.mocked(createTerminalTicket).mockReturnValueOnce('signed-ticket');

    const request = new NextRequest('http://localhost/api/sessions/new', {
      method: 'POST',
      body: JSON.stringify({ type: 'sh', dir: 'side_projects', name: 'terminal-qa' }),
    });
    const body = (await (await POST(request)).json()) as TerminalActionResult;

    expect(prepareSession).toHaveBeenCalledWith('sh', 'side_projects', '', 'terminal-qa');
    expect(createTerminalTicket).toHaveBeenCalledWith({
      kind: 'launch',
      sessionName: 'sh-terminal-qa',
      type: 'sh',
      dir: 'side_projects',
    });
    expect(body).toEqual({
      ok: true,
      message: 'Launching sh-terminal-qa',
      terminal: { sessionName: 'sh-terminal-qa', ticket: 'signed-ticket' },
    });
  });

  it('rejects unsupported session types', async () => {
    const request = new NextRequest('http://localhost/api/sessions/new', {
      method: 'POST',
      body: JSON.stringify({ type: 'other' }),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(prepareSession).not.toHaveBeenCalled();
  });
});
