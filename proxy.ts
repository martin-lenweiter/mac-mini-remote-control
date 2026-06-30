import { type NextRequest, NextResponse } from 'next/server';

// CSRF/origin guard. State-changing API calls (POST/DELETE) trigger real OS
// side effects (spawn Terminal, open VNC, create tunnels), so a malicious page
// in the browser must not be able to drive them. Browsers always attach
// `Sec-Fetch-Site` to fetch/form requests; anything not same-origin is rejected.
// Non-browser clients (curl, CLI) send neither header and are allowed through —
// this is a single-user local tool, the threat model is the browser tab.

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function blocked(message: string) {
  return NextResponse.json({ ok: false, message }, { status: 403 });
}

export function proxy(req: NextRequest) {
  if (!MUTATING.has(req.method)) return NextResponse.next();

  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return blocked('Cross-site request blocked');

  const origin = req.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.get('host')) {
        return blocked('Cross-site request blocked');
      }
    } catch {
      return blocked('Bad origin');
    }
  }

  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
