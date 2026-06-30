import { type NextRequest, NextResponse } from 'next/server';
import { killSession } from '@/lib/rig';
import type { ActionResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { name } = (await req.json()) as { name?: string };
    if (!name) {
      return NextResponse.json<ActionResult>(
        { ok: false, message: 'Missing session name' },
        { status: 400 },
      );
    }
    await killSession(name);
    return NextResponse.json<ActionResult>({ ok: true, message: `Killed ${name}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json<ActionResult>({ ok: false, message }, { status: 500 });
  }
}
