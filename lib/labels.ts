// Client-safe display labels. lib/config.ts is server-only (reads process.env),
// so anything the browser needs to show lives here.
export const RIG_LABEL = process.env.NEXT_PUBLIC_RIG_LABEL ?? 'mini';
