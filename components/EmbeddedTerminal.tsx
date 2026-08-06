'use client';

import type { Terminal as XtermTerminal } from '@xterm/xterm';
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  PanelBottomClose,
  RotateCw,
  TerminalSquare,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { TerminalConnection } from '@/lib/types';

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

function enablePixelSmoothScroll(container: HTMLElement, getRows: () => number) {
  const viewport = container.querySelector<HTMLElement>('.xterm-viewport');
  const screen = container.querySelector<HTMLElement>('.xterm-screen');
  if (!viewport || !screen) return () => {};

  const syncOffset = () => {
    const cellHeight = screen.getBoundingClientRect().height / getRows();
    if (!cellHeight) return;

    const nearestRow = Math.round(viewport.scrollTop / cellHeight);
    const offset = nearestRow * cellHeight - viewport.scrollTop;
    const devicePixelRatio = screen.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const roundedOffset = Math.round(offset * devicePixelRatio) / devicePixelRatio;
    screen.style.transform = roundedOffset ? `translateY(${roundedOffset}px)` : '';
    screen.style.willChange = roundedOffset ? 'transform' : '';
  };

  viewport.addEventListener('scroll', syncOffset, { passive: true });
  return () => {
    viewport.removeEventListener('scroll', syncOffset);
    screen.style.transform = '';
    screen.style.willChange = '';
  };
}

function enableTouchScroll(container: HTMLElement) {
  const pixelsPerLine = 12;
  let startX: number | null = null;
  let startY: number | null = null;
  let lastY: number | null = null;
  let lastX = 0;
  let pendingDelta = 0;
  let scrollFrame = 0;
  let scrolling = false;

  const dispatchLines = () => {
    scrollFrame = 0;
    const terminal = container.querySelector<HTMLElement>('.xterm');
    if (!terminal) return;

    const direction = Math.sign(pendingDelta);
    if (Math.abs(pendingDelta) < pixelsPerLine) return;
    pendingDelta -= direction * pixelsPerLine;

    terminal.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: lastX,
        clientY: lastY ?? 0,
        deltaMode: WheelEvent.DOM_DELTA_LINE,
        deltaY: direction,
      }),
    );
    if (Math.abs(pendingDelta) >= pixelsPerLine) scheduleScroll();
  };
  const scheduleScroll = () => {
    if (scrollFrame === 0) scrollFrame = requestAnimationFrame(dispatchLines);
  };
  const reset = () => {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    startX = null;
    startY = null;
    lastY = null;
    pendingDelta = 0;
    scrolling = false;
  };
  const finish = () => {
    startX = null;
    startY = null;
    scrolling = false;
    if (Math.abs(pendingDelta) >= pixelsPerLine) scheduleScroll();
  };
  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      reset();
      return;
    }
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    pendingDelta = 0;
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    lastX = touch.clientX;
    lastY = touch.clientY;
  };
  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1 || startX === null || startY === null || lastY === null) {
      return;
    }

    const touch = event.touches[0];
    if (!scrolling) {
      const deltaX = Math.abs(touch.clientX - startX);
      const deltaY = Math.abs(touch.clientY - startY);
      if (deltaY < 4 || deltaY <= deltaX) return;
      scrolling = true;
    }

    event.preventDefault();
    pendingDelta = Math.max(
      -pixelsPerLine * 6,
      Math.min(pixelsPerLine * 6, pendingDelta + lastY - touch.clientY),
    );
    lastX = touch.clientX;
    lastY = touch.clientY;
    scheduleScroll();
  };

  container.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  container.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  container.addEventListener('touchend', finish, { capture: true, passive: true });
  container.addEventListener('touchcancel', reset, { capture: true, passive: true });

  return () => {
    container.removeEventListener('touchstart', onTouchStart, true);
    container.removeEventListener('touchmove', onTouchMove, true);
    container.removeEventListener('touchend', finish, true);
    container.removeEventListener('touchcancel', reset, true);
  };
}

function enableLocalMouseSelection(terminal: XtermTerminal) {
  const element = terminal.element;
  const screen = element?.querySelector<HTMLElement>('.xterm-screen');
  if (!element || !screen) return () => {};

  let removeDragListeners = () => {};
  const positionAt = (pointer: { clientX: number; clientY: number }) => {
    const bounds = screen.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;

    const column = Math.max(
      0,
      Math.min(
        terminal.cols - 1,
        Math.floor(((pointer.clientX - bounds.left) / bounds.width) * terminal.cols),
      ),
    );
    const viewportRow = Math.max(
      0,
      Math.min(
        terminal.rows - 1,
        Math.floor(((pointer.clientY - bounds.top) / bounds.height) * terminal.rows),
      ),
    );
    return { column, row: terminal.buffer.active.viewportY + viewportRow };
  };
  const startSelection = (event: MouseEvent) => {
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    removeDragListeners();
    const anchor = positionAt(event);
    if (!anchor) return;

    const anchorIndex = anchor.row * terminal.cols + anchor.column;
    let latestPointer = { clientX: event.clientX, clientY: event.clientY };
    let scrollFrame = 0;
    let lastScrollTime = 0;
    const updateSelection = (pointer: { clientX: number; clientY: number }) => {
      const current = positionAt(pointer);
      if (!current) return;

      const currentIndex = current.row * terminal.cols + current.column;
      const startIndex = Math.min(anchorIndex, currentIndex);
      const endIndex = Math.max(anchorIndex, currentIndex) + 1;
      terminal.select(
        startIndex % terminal.cols,
        Math.floor(startIndex / terminal.cols),
        endIndex - startIndex,
      );
    };
    const autoScroll = (time: number) => {
      const bounds = screen.getBoundingClientRect();
      const overflow =
        latestPointer.clientY < bounds.top
          ? latestPointer.clientY - bounds.top
          : latestPointer.clientY > bounds.bottom
            ? latestPointer.clientY - bounds.bottom
            : 0;
      if (overflow === 0) {
        scrollFrame = 0;
        return;
      }

      const interval = Math.max(60, 160 - Math.min(Math.abs(overflow), 100));
      if (time - lastScrollTime >= interval) {
        const direction = Math.sign(overflow);
        if (terminal.modes.mouseTrackingMode === 'none') {
          terminal.scrollLines(direction);
        } else {
          const column = Math.max(
            1,
            Math.min(
              terminal.cols,
              Math.floor(((latestPointer.clientX - bounds.left) / bounds.width) * terminal.cols) +
                1,
            ),
          );
          const button = direction > 0 ? 65 : 64;
          const row = direction > 0 ? terminal.rows : 1;
          terminal.input(`\x1b[<${button};${column};${row}M`, false);
        }
        updateSelection(latestPointer);
        lastScrollTime = time;
      }
      scrollFrame = requestAnimationFrame(autoScroll);
    };
    const scheduleAutoScroll = () => {
      if (scrollFrame === 0) autoScroll(performance.now());
    };
    const continueSelection = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      moveEvent.stopImmediatePropagation();
      latestPointer = { clientX: moveEvent.clientX, clientY: moveEvent.clientY };
      updateSelection(latestPointer);
      scheduleAutoScroll();
    };
    const finishSelection = (upEvent: MouseEvent) => {
      upEvent.preventDefault();
      upEvent.stopImmediatePropagation();
      removeDragListeners();
      terminal.focus();
    };
    removeDragListeners = () => {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = 0;
      element.ownerDocument.removeEventListener('mousemove', continueSelection, true);
      element.ownerDocument.removeEventListener('mouseup', finishSelection, true);
      removeDragListeners = () => {};
    };
    element.ownerDocument.addEventListener('mousemove', continueSelection, true);
    element.ownerDocument.addEventListener('mouseup', finishSelection, true);
  };

  element.addEventListener('mousedown', startSelection, true);
  return () => {
    removeDragListeners();
    element.removeEventListener('mousedown', startSelection, true);
  };
}

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
        fontSize: window.matchMedia('(max-width: 640px)').matches ? 12 : 13,
        lineHeight: 1.25,
        scrollback: 10_000,
        scrollSensitivity: 2,
        fastScrollSensitivity: 5,
        smoothScrollDuration: 0,
        allowProposedApi: false,
        screenReaderMode: true,
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
      const disablePixelSmoothScroll = enablePixelSmoothScroll(
        containerRef.current,
        () => terminal.rows,
      );
      const disableTouchScroll = enableTouchScroll(containerRef.current);
      const disableLocalMouseSelection = enableLocalMouseSelection(terminal);
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
      const isLocalDashboard =
        window.location.protocol === 'http:' &&
        window.location.port === '4321' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      const gatewayHost =
        window.location.protocol === 'https:' || !isLocalDashboard
          ? window.location.host
          : `${window.location.hostname}:4322`;
      const url = new URL(`${protocol}//${gatewayHost}/terminal`);
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
        disablePixelSmoothScroll();
        disableTouchScroll();
        disableLocalMouseSelection();
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
    <section className="fixed inset-0 z-50 flex h-[100dvh] flex-col overflow-hidden bg-[#0b0d0e] sm:static sm:block sm:h-auto sm:rounded-xl sm:border sm:border-border/70 sm:shadow-2xl sm:shadow-black/20">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-white/10 bg-[#141617] px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 sm:min-h-11 sm:px-3 sm:py-2">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onCollapse}
          aria-label="Back to dashboard"
          className="size-10 text-zinc-300 hover:bg-white/10 hover:text-white sm:hidden"
        >
          <ArrowLeft className="size-5" />
        </Button>
        <TerminalSquare className="hidden size-4 text-amber-300/80 sm:block" />
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
            className="size-10 text-zinc-400 hover:bg-white/10 hover:text-white sm:size-7"
          >
            <ExternalLink className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onCollapse}
            aria-label="Collapse terminal"
            className="hidden text-zinc-400 hover:bg-white/10 hover:text-white sm:inline-flex sm:size-7"
          >
            <PanelBottomClose className="size-4" />
          </Button>
        </div>
      </header>
      <section
        ref={containerRef}
        className="embedded-terminal min-h-0 flex-1 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:h-[clamp(360px,55vh,620px)] sm:min-h-[420px] sm:flex-none sm:py-2 lg:h-[calc(100vh-11rem)] lg:min-h-[520px] [&_.xterm-viewport]:overscroll-contain [&_.xterm]:h-full [&_.xterm]:touch-none"
        aria-label={`Terminal for ${connection.sessionName}`}
      />
    </section>
  );
}
