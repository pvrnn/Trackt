import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { GlassCard } from './GlassCard';

/**
 * The app's one modal, on Radix's dialog. Radix owns the contract the
 * hand-rolled focus trap only approximated: focus moves inside and returns to
 * the opener, Tab is confined, Escape and backdrop-click close, page scroll
 * locks, and content behind is hidden from assistive tech.
 *
 * Always pair with `ModalTitle` — Radix derives the accessible name from it.
 */
export function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-ink/70 backdrop-blur-sm" />
        {/* Body copy differs per dialog, so the title alone carries the name. */}
        <Dialog.Content aria-describedby={undefined} asChild>
          <GlassCard
            as="section"
            className="fixed top-1/2 left-1/2 z-30 max-h-[88vh] w-[calc(100%-3rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto bg-ink/90 p-7"
          >
            {children}
          </GlassCard>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Modal heading — doubles as the dialog's accessible name. */
export function ModalTitle({ children }: { children: ReactNode }) {
  return <Dialog.Title className="font-heading text-[28px] uppercase">{children}</Dialog.Title>;
}
