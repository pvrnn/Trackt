import { useEffect, type RefObject } from 'react';

/** Below this many pixels a press is still a click on whatever is under it. */
const DRAG_THRESHOLD = 5;

/**
 * Pan a horizontal scroller by grabbing it with the mouse. Touch and pens keep
 * native scrolling. The pointer is captured only once the press turns into a
 * drag: capturing on pointerdown retargets the click to the scroller, and a
 * plain click on a link inside it would stop navigating.
 */
export function useDragScroll(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let pointerId: number | null = null;
    let startX = 0;
    let startScroll = 0;
    let dragging = false;

    const suppressClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startScroll = el.scrollLeft;
      dragging = false;
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD) return;
        dragging = true;
        el.setPointerCapture(event.pointerId);
        el.dataset.dragging = '';
      }
      el.scrollLeft = startScroll - dx;
    };
    const onEnd = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      if (!dragging) return;
      dragging = false;
      delete el.dataset.dragging;
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
      // The release over a link still fires its click; swallow that one.
      window.addEventListener('click', suppressClick, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', suppressClick, { capture: true }), 0);
    };
    // Links and covers are natively draggable, which would hijack the pan.
    const onDragStart = (event: DragEvent) => event.preventDefault();

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onEnd);
    el.addEventListener('pointercancel', onEnd);
    el.addEventListener('dragstart', onDragStart);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onEnd);
      el.removeEventListener('pointercancel', onEnd);
      el.removeEventListener('dragstart', onDragStart);
      window.removeEventListener('click', suppressClick, { capture: true });
    };
  }, [ref]);
}
