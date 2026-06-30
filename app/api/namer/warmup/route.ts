import { NextResponse } from 'next/server';
import { warmupNamer } from '@/lib/naming';
import type { ActionResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Fire-and-forget: preload the gemma model so the first real name generation
// isn't a cold start. Always reports ok — warmup failing is non-fatal.
export async function POST() {
  await warmupNamer();
  return NextResponse.json<ActionResult>({ ok: true, message: 'warm' });
}
