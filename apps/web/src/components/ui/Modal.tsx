import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { GlassCard } from './GlassCard';

/**
 * Exit animation length (`dialog-*` keyframes in styles.css). A dialog that
 * wants the fade-out sets `open` false and unmounts itself this long after.
 */
export const MODAL_EXIT_MS = 200;

/**
 * The app's one modal, on Radix's dialog. Radix owns the contract the
 * hand-rolled focus trap only approximated: focus moves inside and returns to
 * the opener, Tab is confined, Escape and backdrop-click close, page scroll
 * locks, and content behind is hidden from assistive tech.
 *
 * Always pair with `ModalTitle`, since Radix derives the accessible name from it.
 *
 * `open` is for dialogs that animate out: Radix keeps the content mounted until
 * its exit animation ends, so flipping it false plays the close instead of
 * snapping the dialog away. Leave it alone for the unmount-on-close dialogs.
 */
export function Modal({
  open = true,
  onClose,
  children,
}: {
  open?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-30 bg-ink/70 backdrop-blur-sm" />
        {/* Body copy differs per dialog, so the title alone carries the name. */}
        <Dialog.Content aria-describedby={undefined} asChild>
          <GlassCard
            as="section"
            className="dialog-content fixed top-1/2 left-1/2 z-30 max-h-[88vh] w-[calc(100%-3rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto bg-ink/90 p-7"
          >
            {children}
          </GlassCard>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Modal heading that doubles as the dialog's accessible name. */
export function ModalTitle({ children }: { children: ReactNode }) {
  return <Dialog.Title className="font-heading text-[28px] uppercase">{children}</Dialog.Title>;
}
