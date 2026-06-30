import { type NextRequest, NextResponse } from 'next/server';
import { forwardPort, unforwardPort } from '@/lib/rig';
import type { ActionResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parsePort(value: unknown): number | null {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { port?: unknown };
    const port = parsePort(body.port);
    if (port === null) {
      return NextResponse.json<ActionResult>(
        { ok: false, message: 'Invalid port' },
        { status: 400 },
      );
    }
    await forwardPort(port);
    return NextResponse.json<ActionResult>({ ok: true, message: `Forwarding :${port}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json<ActionResult>({ ok: false, message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as { port?: unknown };
    const port = parsePort(body.port);
    if (port === null) {
      return NextResponse.json<ActionResult>(
        { ok: false, message: 'Invalid port' },
        { status: 400 },
      );
    }
    await unforwardPort(port);
    return NextResponse.json<ActionResult>({ ok: true, message: `Stopped forwarding :${port}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json<ActionResult>({ ok: false, message }, { status: 500 });
  }
}
