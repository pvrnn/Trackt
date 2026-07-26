import * as AlertDialog from '@radix-ui/react-alert-dialog';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { GlassCard } from './GlassCard';

/**
 * Destructive confirm, on Radix's alert dialog rather than `Modal`. The
 * difference is deliberate: `role="alertdialog"`, focus lands on Cancel, and an
 * outside click does *not* dismiss — a misclick shouldn't be able to answer a
 * question about deleting something.
 */
export function ConfirmDialog({
  title,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <AlertDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-30 bg-ink/70 backdrop-blur-sm" />
        <AlertDialog.Content asChild>
          <GlassCard
            as="section"
            className="fixed top-1/2 left-1/2 z-30 flex max-h-[88vh] w-[calc(100%-3rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-5 overflow-y-auto bg-ink/90 p-7"
          >
            <AlertDialog.Title className="font-display text-[28px] uppercase">
              {title}
            </AlertDialog.Title>
            <AlertDialog.Description className="text-[15px] text-muted">
              {children}
            </AlertDialog.Description>
            <div className="flex justify-end gap-3">
              <AlertDialog.Cancel asChild>
                <Button variant="ghost" disabled={busy}>
                  CANCEL
                </Button>
              </AlertDialog.Cancel>
              {/* Not AlertDialog.Action: that closes on select, which would tear
                  the dialog down mid-request and lose the busy state. */}
              <Button disabled={busy} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </div>
          </GlassCard>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
