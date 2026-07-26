import { NextResponse } from 'next/server';
import { openSoftwareUpdate } from '@/lib/rig';
import type { ActionResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await openSoftwareUpdate();
    return NextResponse.json<ActionResult>({
      ok: true,
      message: 'Opening Software Update on the mini',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json<ActionResult>({ ok: false, message }, { status: 500 });
  }
}
