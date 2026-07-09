import clsx from 'clsx';

export interface AuraBackgroundProps {
  /** Marketing/login pages get brighter glows than app pages (design handoff). */
  variant?: 'marketing' | 'app';
}

/**
 * The AURA PRISM background recipe: a fixed aura layer (violet/pink/gold radials)
 * under a fixed grain film. Render once, before the page's `relative` content
 * wrapper — layering is by DOM order, no z-index.
 */
export function AuraBackground({ variant = 'app' }: AuraBackgroundProps) {
  return (
    <>
      <div
        aria-hidden
        className={clsx('aura-fixed', variant === 'marketing' ? 'aura-marketing' : 'aura-app')}
      />
      <div aria-hidden className="aura-fixed grain" />
    </>
  );
}
