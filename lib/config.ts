// Rig configuration. Defaults match the coding-setup rig (~/code/coding-setup).
// Override via .env.local without touching code; never commit a real Tailnet host.

export const RIG = {
  /** SSH alias for the mini, as defined in ~/.ssh/config. */
  sshAlias: process.env.RIG_SSH_ALIAS ?? 'mini',
  /** Directory picker root on the mini. Used for the repo picker and -C launches. */
  codeRoot: process.env.RIG_CODE_ROOT ?? '~',
  /** Headed-Chrome remote-debugging port on the mini (LOCAL_CDP_PORT). */
  cdpPort: Number(process.env.RIG_CDP_PORT ?? 9335),
  /** VNC screen-share tunnel ports (local:remote). */
  vncLocalPort: 5901,
  vncRemotePort: 5900,
  /** cmux CLI used to open interactive sessions in a new cmux workspace. */
  cmuxBin: process.env.RIG_CMUX_BIN ?? '/Applications/cmux.app/Contents/Resources/bin/cmux',
  /** SSH connect timeout (seconds) for read probes. */
  connectTimeout: 6,
} as const;

// Local LLM used to auto-name sessions. Runs on the laptop via ollama so naming
// works regardless of which coding agent is in use; falls back to a repo-derived
// name if ollama is unavailable.
export const NAMER = {
  url: process.env.RIG_OLLAMA_URL ?? 'http://localhost:11434',
  model: process.env.RIG_NAMER_MODEL ?? 'gemma4:e4b',
  /** Generation timeout (ms). On timeout we fall back to the repo name. */
  timeoutMs: Number(process.env.RIG_NAMER_TIMEOUT_MS ?? 12000),
} as const;
