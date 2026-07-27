import { type NextRequest, NextResponse } from 'next/server';
import { prepareSession } from '@/lib/rig';
import { createTerminalTicket } from '@/lib/terminal-ticket';
import type { AgentType, TerminalActionResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES: AgentType[] = ['cc', 'cx', 'sh'];

export async function POST(req: NextRequest) {
  try {
    const { type, dir, task, name } = (await req.json()) as {
      type?: string;
      dir?: string;
      task?: string;
      name?: string;
    };
    if (!type || !TYPES.includes(type as AgentType)) {
      return NextResponse.json<TerminalActionResult>(
        { ok: false, message: 'Invalid session type' },
        { status: 400 },
      );
    }
    const prepared = await prepareSession(
      type as AgentType,
      typeof dir === 'string' ? dir : '',
      typeof task === 'string' ? task : '',
      typeof name === 'string' ? name : '',
    );
    return NextResponse.json<TerminalActionResult>({
      ok: true,
      message: `Launching ${prepared.sessionName}`,
      terminal: {
        sessionName: prepared.sessionName,
        ticket: createTerminalTicket({ kind: 'launch', ...prepared }),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json<TerminalActionResult>({ ok: false, message }, { status: 500 });
  }
}
