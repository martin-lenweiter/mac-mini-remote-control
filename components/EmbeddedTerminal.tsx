'use client';

import { ExternalLink, Loader2, PanelBottomClose, RotateCw, TerminalSquare } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { TerminalConnection } from '@/lib/types';

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export function EmbeddedTerminal({
  connection,
  onCollapse,
  onReconnect,
  onOpenInCmux,
}: {
  connection: TerminalConnection;
  onCollapse: () => void;
  onReconnect: () => void;
  onOpenInCmux: () => void;
}) {
  const containerRef = useRef<HTMLElement>(null);
  const [state, setState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let disposeTerminal: (() => void) | null = null;

    async function connect() {
      setState('connecting');
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (!active || !containerRef.current) return;

      const terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontFamily: "'SF Mono', Menlo, Monaco, monospace",
        fontSize: 13,
        lineHeight: 1.25,
        scrollback: 10_000,
        scrollSensitivity: 4,
        fastScrollSensitivity: 5,
        smoothScrollDuration: 0,
        allowProposedApi: false,
        theme: {
          background: '#0b0d0e',
          foreground: '#e7e7e4',
          cursor: '#f2c46d',
          cursorAccent: '#0b0d0e',
          selectionBackground: '#334155',
          black: '#18181b',
          red: '#f87171',
          green: '#86efac',
          yellow: '#fde68a',
          blue: '#93c5fd',
          magenta: '#d8b4fe',
          cyan: '#67e8f9',
          white: '#e4e4e7',
          brightBlack: '#71717a',
          brightRed: '#fca5a5',
          brightGreen: '#bbf7d0',
          brightYellow: '#fef08a',
          brightBlue: '#bfdbfe',
          brightMagenta: '#e9d5ff',
          brightCyan: '#a5f3fc',
          brightWhite: '#fafafa',
        },
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);
      fitAddon.fit();
      terminal.focus();
      const ruleGlyphs = terminal.onRender(({ start, end }) => {
        const rows = containerRef.current?.querySelectorAll('.xterm-rows > div');
        if (!rows) return;

        for (let rowIndex = start; rowIndex <= end; rowIndex++) {
          const row = rows.item(rowIndex);
          if (!row) continue;
          for (const span of row.querySelectorAll('span')) {
            span.style.visibility = span.textContent?.includes('─') ? 'hidden' : '';
          }
        }
      });

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = new URL(`${protocol}//${window.location.hostname}:4322/terminal`);
      url.searchParams.set('ticket', connection.ticket);
      socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';

      const outputChunks: Uint8Array[] = [];
      let outputBytes = 0;
      let outputFrame = 0;
      const flushOutput = () => {
        outputFrame = 0;
        if (outputBytes === 0) return;

        const output = new Uint8Array(outputBytes);
        let offset = 0;
        for (const chunk of outputChunks) {
          output.set(chunk, offset);
          offset += chunk.byteLength;
        }
        outputChunks.length = 0;
        outputBytes = 0;
        terminal.write(output);
      };

      const sendSize = () => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
        }
      };

      socket.addEventListener('open', () => {
        if (!active) return;
        setState('connected');
        sendSize();
        terminal.focus();
      });
      socket.addEventListener('message', (event) => {
        if (!active || !(event.data instanceof ArrayBuffer)) return;

        const chunk = new Uint8Array(event.data);
        outputChunks.push(chunk);
        outputBytes += chunk.byteLength;
        if (outputBytes >= 64 * 1024) {
          cancelAnimationFrame(outputFrame);
          flushOutput();
        } else if (outputFrame === 0) {
          outputFrame = requestAnimationFrame(flushOutput);
        }
      });
      socket.addEventListener('close', () => {
        if (active) setState('disconnected');
      });
      socket.addEventListener('error', () => {
        if (active) setState('disconnected');
      });

      const input = terminal.onData((data) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'input', data }));
        }
      });
      let resizeFrame = 0;
      resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          fitAddon.fit();
          sendSize();
        });
      });
      resizeObserver.observe(containerRef.current);

      disposeTerminal = () => {
        cancelAnimationFrame(outputFrame);
        cancelAnimationFrame(resizeFrame);
        ruleGlyphs.dispose();
        input.dispose();
        resizeObserver?.disconnect();
        terminal.dispose();
      };
    }

    void connect().catch(() => {
      if (active) setState('disconnected');
    });
    return () => {
      active = false;
      socket?.close(1000, 'Terminal panel closed');
      disposeTerminal?.();
    };
  }, [connection.ticket]);

  return (
    <section className="overflow-hidden rounded-xl border border-border/70 bg-[#0b0d0e] shadow-2xl shadow-black/20">
      <header className="flex min-h-11 flex-wrap items-center gap-2 border-b border-white/10 bg-[#141617] px-3 py-2">
        <TerminalSquare className="size-4 text-amber-300/80" />
        <span className="min-w-0 truncate font-mono text-sm text-zinc-100">
          {connection.sessionName}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-400" aria-live="polite">
          {state === 'connecting' ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <span
              className={`size-1.5 rounded-full ${
                state === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
            />
          )}
          {state}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {state === 'disconnected' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onReconnect}
              className="h-8 text-zinc-300 hover:bg-white/10 hover:text-white"
            >
              <RotateCw className="size-3.5" />
              Reconnect
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onOpenInCmux}
            aria-label={`Open ${connection.sessionName} in cmux`}
            className="text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            <ExternalLink className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onCollapse}
            aria-label="Collapse terminal"
            className="text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            <PanelBottomClose className="size-4" />
          </Button>
        </div>
      </header>
      <section
        ref={containerRef}
        className="embedded-terminal h-[clamp(360px,55vh,620px)] px-2 py-2 lg:h-[calc(100vh-11rem)] lg:min-h-[520px] [&_.xterm-viewport]:overscroll-contain [&_.xterm]:h-full"
        aria-label={`Terminal for ${connection.sessionName}`}
      />
    </section>
  );
}
