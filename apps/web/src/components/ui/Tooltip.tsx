import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';

/**
 * Hover/focus tooltip, replacing the native `title` attribute. Two things `title`
 * doesn't do: reach keyboard users, and appear in under a second.
 *
 * Note the trigger must be focusable for the keyboard half to work — inert
 * placeholders (`<span>`s that explain why a control isn't live yet) need
 * `tabIndex={0}`, otherwise the copy stays mouse-only.
 *
 * Radix deliberately does not open tooltips on touch; genuinely essential copy
 * belongs on screen, not in here.
 */
export function Tooltip({ label, children }: { label: ReactNode; children: ReactElement }) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={8}
            collisionPadding={12}
            className="z-40 max-w-[260px] rounded-[10px] border border-glass-border bg-ink/95 px-3 py-2 font-label text-[11px] font-semibold tracking-label text-muted shadow-xl backdrop-blur-[16px]"
          >
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
