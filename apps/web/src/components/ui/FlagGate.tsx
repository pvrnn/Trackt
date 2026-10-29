import type { ReactNode } from 'react';
import type { FlagKey } from '@trackt/shared';
import { useFlag } from '@trackt/client';

/**
 * Renders `children` when the flag is on, and a named "not on this instance"
 * panel when it is off (ADR-0011).
 *
 * A deep link to a gated surface must not redirect silently (reads as a bug) or
 * render blank (reads as a broken build), so the panel says what happened. The
 * caller owns the layout — this renders a heading and a paragraph — and the copy
 * is per call site, because the registry carries no user-facing strings.
 */
export function FlagGate({
  flag,
  title,
  body,
  children,
}: {
  flag: FlagKey;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  const enabled = useFlag(flag);
  if (enabled) return <>{children}</>;

  return (
    <>
      <h1 className="font-heading text-[56px] leading-none uppercase">{title}</h1>
      <p className="max-w-[540px] text-[15px] text-muted">{body}</p>
    </>
  );
}
