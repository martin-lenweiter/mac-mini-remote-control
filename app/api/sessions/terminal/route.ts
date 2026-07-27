import { type NextRequest, NextResponse } from 'next/server';
import { assertSessionExists } from '@/lib/rig';
import { createTerminalTicket } from '@/lib/terminal-ticket';
import type { TerminalActionResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { name } = (await req.json()) as { name?: string };
    if (!name) {
      return NextResponse.json<TerminalActionResult>(
        { ok: false, message: 'Missing session name' },
        { status: 400 },
      );
    }
    await assertSessionExists(name);
    return NextResponse.json<TerminalActionResult>({
      ok: true,
      message: `Connected to ${name}`,
      terminal: {
        sessionName: name,
        ticket: createTerminalTicket({ kind: 'attach', sessionName: name }),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json<TerminalActionResult>({ ok: false, message }, { status: 500 });
  }
}
