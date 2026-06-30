import { type NextRequest, NextResponse } from 'next/server';
import { newSession } from '@/lib/rig';
import type { ActionResult, AgentType } from '@/lib/types';

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
      return NextResponse.json<ActionResult>(
        { ok: false, message: 'Invalid session type' },
        { status: 400 },
      );
    }
    const created = await newSession(
      type as AgentType,
      typeof dir === 'string' ? dir : '',
      typeof task === 'string' ? task : '',
      typeof name === 'string' ? name : '',
    );
    return NextResponse.json<ActionResult>({ ok: true, message: `Launching ${created}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json<ActionResult>({ ok: false, message }, { status: 500 });
  }
}
