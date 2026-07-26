import { NextResponse } from 'next/server';
import { getStatus } from '@/lib/rig';
import type { RigStatus } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await getStatus();
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const fallback: RigStatus = {
      sessions: [],
      tunnels: [],
      devServers: [],
      health: null,
      reachable: false,
      error: message,
      fetchedAt: Date.now(),
    };
    return NextResponse.json(fallback);
  }
}
