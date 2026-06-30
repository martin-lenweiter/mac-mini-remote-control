import { type NextRequest, NextResponse } from 'next/server';
import { listDirs } from '@/lib/rig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const path = req.nextUrl.searchParams.get('path') ?? '';
    return NextResponse.json({ entries: await listDirs(path) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ entries: [], error: message }, { status: 400 });
  }
}
