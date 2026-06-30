'use client';

import { Folder, Loader2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fetchDirs, warmupNamer } from '@/lib/client';
import type { ActionResult, AgentType } from '@/lib/types';

const TYPES: { value: AgentType; label: string }[] = [
  { value: 'cc', label: 'Claude Code' },
  { value: 'cx', label: 'Codex' },
  { value: 'sh', label: 'Shell' },
];

interface NewSessionDialogProps {
  onLaunch: (type: AgentType, dir: string, task: string, name: string) => Promise<ActionResult>;
}

export function NewSessionDialog({ onLaunch }: NewSessionDialogProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<AgentType>('cc');
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<string[]>([]);
  const [loadingDirs, setLoadingDirs] = useState(false);
  const [name, setName] = useState('');
  const [task, setTask] = useState('');
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    if (!open) return;
    warmupNamer();
    setLoadingDirs(true);
    let active = true;
    fetchDirs(path)
      .then((e) => active && setEntries(e))
      .finally(() => active && setLoadingDirs(false));
    return () => {
      active = false;
    };
  }, [open, path]);

  const segments = path ? path.split('/') : [];

  async function handleLaunch() {
    setLaunching(true);
    try {
      const res = await onLaunch(type, path, task, name);
      if (res.ok) {
        setName('');
        setTask('');
        setPath('');
        setOpen(false);
      }
    } finally {
      setLaunching(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="size-4" />
            New session
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New session</DialogTitle>
          <DialogDescription>
            Pick a directory under <span className="font-mono">~/code</span>, then launch. The name
            is generated locally from what you're working on.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">Agent</span>
            <Select value={type} onValueChange={(v) => setType(v as AgentType)}>
              <SelectTrigger>
                <SelectValue>
                  {(value) => TYPES.find((t) => t.value === value)?.label ?? value}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">Working directory</span>
            <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm">
              <button
                type="button"
                onClick={() => setPath('')}
                className="font-mono text-muted-foreground hover:text-foreground"
              >
                ~/code
              </button>
              {segments.map((seg, i) => (
                <span key={segments.slice(0, i + 1).join('/')} className="flex items-center gap-1">
                  <span className="text-muted-foreground">/</span>
                  <button
                    type="button"
                    onClick={() => setPath(segments.slice(0, i + 1).join('/'))}
                    className="font-mono hover:text-foreground"
                  >
                    {seg}
                  </button>
                </span>
              ))}
            </div>
            <ScrollArea className="h-40 rounded-lg border border-border/60">
              {loadingDirs ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : entries.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No subdirectories — launch here.
                </p>
              ) : (
                <ul className="flex flex-col p-1">
                  {entries.map((e) => (
                    <li key={e}>
                      <button
                        type="button"
                        onClick={() => setPath(path ? `${path}/${e}` : e)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <Folder className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate font-mono">{e}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">
              Name <span className="font-normal">(optional)</span>
            </span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="leave blank to auto-name"
              className="font-mono"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !launching) handleLaunch();
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">
              What are you working on? <span className="font-normal">(used only to auto-name)</span>
            </span>
            <Input
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="e.g. fix the login redirect bug"
              disabled={name.trim().length > 0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !launching) handleLaunch();
              }}
            />
          </div>
        </div>

        <DialogFooter className="items-center justify-between sm:justify-between">
          <span className="truncate font-mono text-xs text-muted-foreground">
            starts in ~/code{path ? `/${path}` : ''}
          </span>
          <Button onClick={handleLaunch} disabled={launching}>
            {launching ? <Loader2 className="size-4 animate-spin" /> : 'Launch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
