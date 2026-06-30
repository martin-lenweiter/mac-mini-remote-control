<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Mission Control — agent notes

Local Next.js 16 control panel for the `coding-setup` rig. See `README.md` for the
full picture; this is what matters when changing the code.

## What it is
- Runs **on the laptop**; API routes (`app/api/**`, Node runtime) shell out via
  `lib/rig.ts` to drive the mini over `ssh` and open sessions in **cmux**.
- `lib/rig.ts` is the core: command builders, `ssh` exec, and the output parsers.
  Keep parsers pure and exported so they stay unit-testable (`lib/rig.test.ts`).
- `lib/naming.ts` = local-gemma (ollama) session naming + sanitizer.
- `lib/config.ts` is **server-only** (reads `process.env`); anything the client
  needs goes in `lib/labels.ts` (`NEXT_PUBLIC_*`).

## Hard rules
- **Never interpolate unvalidated input into a shell command.** Names → `assertName`,
  paths → `assertRelPath`/`SAFE_PATH_RE`, ports → `assertPort`. Reads use static
  remote strings. This is the main security surface — don't regress it.
- Keep `proxy.ts` (CSRF/origin guard) and the loopback bind (`-H 127.0.0.1`).
- Sessions are launched through the rig's `cct`/`cxt`/`tmt` launchers (with `-C`),
  not by reimplementing them here — one source of truth. The `-C` flag lives in
  the `coding-setup` repo; update it there (and the mini's `~/.zshrc`) if it changes.
- No secrets in the repo — only the SSH alias; never hardcode the Tailnet host.

## Verify before done
`bun run lint` (zero diagnostics) · `bun run test` · `bun run build` · and, for UI
changes, load it in a browser. Destructive rig actions (kill/rename/new) have real
side effects — test them against throwaway tmux sessions, never the user's live ones.

## Always-on
The panel runs as a launchd service (`scripts/install-service.sh`,
`io.grace.mission-control`) serving the **production build** at `localhost:4321`.
After changing app code, re-run that script to rebuild + reload; `bun run dev`
clashes with it on 4321 (stop the service first).
