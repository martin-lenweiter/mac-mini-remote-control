// Rig configuration. Defaults match the coding-setup rig (~/code/coding-setup).
// Override via .env.local without touching code; never commit a real Tailnet host.

export const RIG = {
  /** SSH alias for the mini, as defined in ~/.ssh/config. */
  sshAlias: process.env.RIG_SSH_ALIAS ?? 'mini',
  /** Repo root on the mini (CODE_ROOT). Used for the repo picker and -C launches. */
  codeRoot: process.env.RIG_CODE_ROOT ?? '~/code',
  /** Headed-Chrome remote-debugging port on the mini (LOCAL_CDP_PORT). */
  cdpPort: Number(process.env.RIG_CDP_PORT ?? 9335),
  /** launchd label for the mini's headed Chrome. */
  chromeLabel: process.env.RIG_CHROME_LABEL ?? 'io.grace.chrome-local',
  /** VNC screen-share tunnel ports (local:remote). */
  vncLocalPort: 5901,
  vncRemotePort: 5900,
  /** cmux CLI used to open interactive sessions in a new cmux workspace. */
  cmuxBin: process.env.RIG_CMUX_BIN ?? '/Applications/cmux.app/Contents/Resources/bin/cmux',
  /**
   * Socket password for cmux's `password` control mode. Required when running
   * outside the cmux process tree (the always-on launchd service), since cmux's
   * default `cmuxOnly` mode rejects external clients. Must match
   * automation.socketPassword in ~/.config/cmux/cmux.json. '' when unset.
   */
  cmuxSocketPassword: process.env.RIG_CMUX_SOCKET_PASSWORD ?? '',
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
