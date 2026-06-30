import { type NextRequest, NextResponse } from 'next/server';
import { renameSession } from '@/lib/rig';
import type { ActionResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { from, to } = (await req.json()) as { from?: string; to?: string };
    if (!from || !to) {
      return NextResponse.json<ActionResult>(
        { ok: false, message: 'Missing name' },
        { status: 400 },
      );
    }
    await renameSession(from, to);
    return NextResponse.json<ActionResult>({ ok: true, message: `Renamed to ${to}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json<ActionResult>({ ok: false, message }, { status: 500 });
  }
}
