'use client';

import {
  Activity,
  Clock3,
  Cpu,
  Download,
  ExternalLink,
  Globe,
  HardDrive,
  Loader2,
  MemoryStick,
  Monitor,
  Pencil,
  RefreshCw,
  TerminalSquare,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ActionButton } from '@/components/ActionButton';
import { NewSessionDialog } from '@/components/NewSessionDialog';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { fetchStatus, runAction } from '@/lib/client';
import { formatBytes, formatIdle, formatUptime, TYPE_LABEL } from '@/lib/format';
import { RIG_LABEL } from '@/lib/labels';
import type { AgentType, DevServer, MiniHealth, RigStatus, SessionInfo } from '@/lib/types';

const TYPE_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  cc: 'default',
  cx: 'secondary',
  sh: 'outline',
  other: 'outline',
};

export function Dashboard() {
  const [status, setStatus] = useState<RigStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    // Skip if a probe is still running so slow SSH reads don't stack up.
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      setStatus(await fetchStatus());
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  const doAction = useCallback(
    async (path: string, body?: Record<string, unknown>, method: 'POST' | 'DELETE' = 'POST') => {
      const res = await runAction(path, body, method);
      if (res.ok) {
        toast.success(res.message);
        await refresh();
      } else {
        toast.error(res.message);
      }
      return res;
    },
    [refresh],
  );

  const reachable = status?.reachable ?? false;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mac Mini Remote Control</h1>
          <p className="text-sm text-muted-foreground">
            Remote coding rig · <span className="font-mono">{RIG_LABEL}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill ok={reachable} loading={!status} />
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} />
            Refresh
          </Button>
        </div>
      </header>

      {status && !reachable && (
        <Card className="mb-6 border-destructive/40">
          <CardContent className="py-4 text-sm text-destructive">
            Can’t reach the mini: {status.error ?? 'unknown error'}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <MiniHealthPanel
          health={status?.health ?? null}
          loading={!status}
          onSoftwareUpdate={() => doAction('/api/software-update')}
        />
        <SessionsPanel
          sessions={status?.sessions ?? []}
          loading={!status}
          onAttach={(name) => doAction('/api/sessions/attach', { name })}
          onKill={(name) => doAction('/api/sessions/kill', { name })}
          onRename={(from, to) => doAction('/api/sessions/rename', { from, to })}
          onNew={(type, dir, task, name) =>
            doAction('/api/sessions/new', { type, dir, task, name })
          }
        />
        <ScreenSharePanel status={status} onScreenshare={() => doAction('/api/screenshare')} />
        <DevServersPanel
          devServers={status?.devServers ?? []}
          loading={!status}
          onForward={(port) => doAction('/api/forward', { port })}
          onStop={(port) => doAction('/api/forward', { port }, 'DELETE')}
        />
      </div>
    </main>
  );
}

function StatusPill({ ok, loading }: { ok: boolean; loading: boolean }) {
  if (loading) {
    return (
      <Badge variant="outline" className="gap-1.5">
        <span className="size-2 rounded-full bg-muted-foreground/50" /> Connecting…
      </Badge>
    );
  }
  return (
    <Badge variant={ok ? 'secondary' : 'destructive'} className="gap-1.5">
      <span className={`size-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-destructive'}`} />
      {ok ? 'Mini online' : 'Offline'}
    </Badge>
  );
}

function SessionsPanel({
  sessions,
  loading,
  onAttach,
  onKill,
  onRename,
  onNew,
}: {
  sessions: SessionInfo[];
  loading: boolean;
  onAttach: (name: string) => Promise<{ ok: boolean; message: string }>;
  onKill: (name: string) => Promise<{ ok: boolean; message: string }>;
  onRename: (from: string, to: string) => Promise<{ ok: boolean; message: string }>;
  onNew: (
    type: AgentType,
    dir: string,
    task: string,
    name: string,
  ) => Promise<{ ok: boolean; message: string }>;
}) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TerminalSquare className="size-4 text-muted-foreground" />
          Sessions
          <Badge variant="outline">{sessions.length}</Badge>
        </CardTitle>
        <CardAction>
          <NewSessionDialog onLaunch={onNew} />
        </CardAction>
      </CardHeader>
      <CardContent>
        {loading ? (
          <EmptyRow text="Loading sessions…" />
        ) : sessions.length === 0 ? (
          <EmptyRow text="No tmux sessions running." />
        ) : (
          <ScrollArea className="h-[420px] pr-3">
            <ul className="flex flex-col gap-1.5">
              {sessions.map((s) => (
                <li
                  key={s.name}
                  className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2"
                >
                  <span
                    className={`size-2 shrink-0 rounded-full ${s.attached ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
                    title={s.attached ? 'attached' : 'detached'}
                  />
                  <Badge variant={TYPE_VARIANT[s.type]} className="shrink-0">
                    {TYPE_LABEL[s.type]}
                  </Badge>
                  <span className="truncate font-mono text-sm">{s.name}</span>
                  {!s.ephemeral && (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      named
                    </Badge>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    idle {formatIdle(s.idleSeconds)}
                  </span>
                  <RenameSessionButton name={s.name} onRename={onRename} />
                  <ActionButton
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    action={() => onAttach(s.name)}
                  >
                    Attach
                  </ActionButton>
                  <KillSessionButton name={s.name} onKill={onKill} />
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function KillSessionButton({
  name,
  onKill,
}: {
  name: string;
  onKill: (name: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [killing, setKilling] = useState(false);

  async function confirm() {
    setKilling(true);
    try {
      const res = await onKill(name);
      if (res.ok) setOpen(false);
    } finally {
      setKilling(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Kill ${name}`}
            className="shrink-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Kill <span className="font-mono">{name}</span>?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This ends the tmux session on the mini. Any agent running inside it is terminated. This
            can’t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={killing}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={killing}
            onClick={(e) => {
              e.preventDefault();
              confirm();
            }}
          >
            {killing ? <Loader2 className="size-4 animate-spin" /> : 'Kill session'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RenameSessionButton({
  name,
  onRename,
}: {
  name: string;
  onRename: (from: string, to: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setValue(name);
  }, [open, name]);

  async function save() {
    const to = value.trim();
    if (!to || to === name) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      const res = await onRename(name, to);
      if (res.ok) setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Rename ${name}`}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Pencil className="size-4" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename session</DialogTitle>
          <DialogDescription>
            tmux session name. The <span className="font-mono">cc-</span>/
            <span className="font-mono">cx-</span>/<span className="font-mono">sh-</span> prefix
            sets the type and protects it from auto-cleanup.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !saving) save();
          }}
          className="font-mono"
        />
        <DialogFooter>
          <Button onClick={save} disabled={saving || !value.trim()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MiniHealthPanel({
  health,
  loading,
  onSoftwareUpdate,
}: {
  health: MiniHealth | null;
  loading: boolean;
  onSoftwareUpdate: () => Promise<{ ok: boolean; message: string }>;
}) {
  if (loading) {
    return (
      <Card className="lg:col-span-3">
        <CardContent>
          <EmptyRow text="Reading mini telemetry…" />
        </CardContent>
      </Card>
    );
  }

  if (!health) {
    return (
      <Card className="lg:col-span-3">
        <CardContent>
          <EmptyRow text="Mini telemetry unavailable." />
        </CardContent>
      </Card>
    );
  }

  const memoryPercent = (health.memoryUsedBytes / health.memoryTotalBytes) * 100;
  const memoryIndicatorClassName =
    health.memoryPressure === 'critical'
      ? 'bg-destructive'
      : health.memoryPressure === 'warning'
        ? 'bg-amber-500'
        : 'bg-emerald-500';
  const update = health.osUpdate;

  return (
    <Card className="overflow-hidden lg:col-span-3">
      <CardHeader className="border-b border-border/60">
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4 text-muted-foreground" />
          Mini health
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-x-6 gap-y-5 pt-1 sm:grid-cols-2 lg:grid-cols-5">
        <HealthMetric
          icon={Cpu}
          label="CPU"
          value={`${Math.round(health.cpuUsedPercent)}%`}
          percent={health.cpuUsedPercent}
        />
        <HealthMetric
          icon={MemoryStick}
          label="Memory"
          value={`${formatBytes(health.memoryUsedBytes)} / ${formatBytes(health.memoryTotalBytes)}`}
          percent={memoryPercent}
          indicatorClassName={memoryIndicatorClassName}
          progressLabel={`Memory usage ${Math.round(memoryPercent)}%, pressure ${health.memoryPressure}`}
        />
        <HealthMetric
          icon={HardDrive}
          label="System disk"
          value={`${health.diskUsedPercent}% used`}
          percent={health.diskUsedPercent}
        />
        <HealthMetric icon={Clock3} label="Uptime" value={formatUptime(health.uptimeSeconds)} />
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Monitor className="size-3.5" />
            Operating system
          </div>
          <p className="truncate font-mono text-sm font-medium">macOS {health.osVersion}</p>
          {update.error ? (
            <p className="mt-2 text-xs text-muted-foreground">Update status unavailable</p>
          ) : update.available ? (
            <ActionButton className="mt-2" size="xs" variant="outline" action={onSoftwareUpdate}>
              <Download className="size-3" />
              Update to {update.version}
            </ActionButton>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Up to date</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function HealthMetric({
  icon: Icon,
  label,
  value,
  percent,
  indicatorClassName,
  progressLabel,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  percent?: number;
  indicatorClassName?: string;
  progressLabel?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="truncate font-mono text-sm font-medium">{value}</p>
      {percent !== undefined && (
        <div
          className="mt-2 h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={progressLabel ?? `${label} usage`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${
              indicatorClassName ??
              (percent >= 90 ? 'bg-destructive' : percent >= 75 ? 'bg-amber-500' : 'bg-emerald-500')
            }`}
            style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
          />
        </div>
      )}
    </div>
  );
}

function ScreenSharePanel({
  status,
  onScreenshare,
}: {
  status: RigStatus | null;
  onScreenshare: () => Promise<{ ok: boolean; message: string }>;
}) {
  const vnc = status?.tunnels.find((tunnel) => tunnel.kind === 'vnc');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Monitor className="size-4 text-muted-foreground" />
          Screen share
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`size-2.5 rounded-full ${vnc?.up ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
          />
          <span className="text-sm font-medium">
            {vnc?.up ? 'VNC tunnel ready' : 'Not connected'}
          </span>
        </div>
        <ActionButton variant="secondary" size="sm" action={onScreenshare}>
          <Monitor className="size-4" />
          {vnc?.up ? 'Open screen share' : 'Start screen share'}
        </ActionButton>
      </CardContent>
    </Card>
  );
}

function DevServersPanel({
  devServers,
  loading,
  onForward,
  onStop,
}: {
  devServers: DevServer[];
  loading: boolean;
  onForward: (port: number) => Promise<{ ok: boolean; message: string }>;
  onStop: (port: number) => Promise<{ ok: boolean; message: string }>;
}) {
  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="size-4 text-muted-foreground" />
          Dev servers on the mini
          <Badge variant="outline">{devServers.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <EmptyRow text="Probing ports…" />
        ) : devServers.length === 0 ? (
          <EmptyRow text="No dev servers listening." />
        ) : (
          <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {devServers.map((d) => (
              <li
                key={d.port}
                className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2"
              >
                <span className="font-mono text-sm">:{d.port}</span>
                <span className="truncate text-xs text-muted-foreground">{d.command}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  {d.forwarded ? (
                    <>
                      <a
                        href={`http://localhost:${d.port}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-emerald-500 hover:underline"
                      >
                        <ExternalLink className="size-3" />
                        open
                      </a>
                      <ActionButton size="sm" variant="ghost" action={() => onStop(d.port)}>
                        <X className="size-4" />
                      </ActionButton>
                    </>
                  ) : (
                    <ActionButton size="sm" variant="outline" action={() => onForward(d.port)}>
                      Forward
                    </ActionButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>;
}
