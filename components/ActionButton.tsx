'use client';

import { Loader2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/types';

type ButtonProps = React.ComponentProps<typeof Button>;

interface ActionButtonProps extends Omit<ButtonProps, 'onClick'> {
  action: () => Promise<ActionResult>;
  children: ReactNode;
}

export function ActionButton({ action, children, disabled, ...props }: ActionButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      await action();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button {...props} disabled={disabled || loading} onClick={handleClick}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : children}
    </Button>
  );
}
