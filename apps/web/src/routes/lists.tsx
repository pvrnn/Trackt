import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { VISIBILITIES, type ListSummary, type Visibility } from '@trackt/shared';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { GlassCard } from '../components/ui/GlassCard';
import { Input } from '../components/ui/Input';
import { Modal, ModalTitle } from '../components/ui/Modal';
import { Tooltip } from '../components/ui/Tooltip';
import { useAuthedPage } from '../lib/auth-client';
import { useFormat } from '../lib/format';
import { useLabels } from '../lib/labels';
import { coverGradient, useCreateList, useLists } from '@trackt/client';

export const Route = createFileRoute('/lists')({
  head: ({ match }) => ({ meta: [{ title: match.context.i18n.t('meta.lists') }] }),
  component: ListsPage,
});

/**
 * The mockup's three scopes. Only MY LISTS has a backing feature: FRIENDS
 * needs a friends-scoped lists endpoint (out of scope for ADR-0006 phase 2;
 * see `docs/friends-plan.md`) and COLLABORATIVE needs a membership table, so
 * both render visibly inert rather than as controls that quietly do nothing.
 */
const SCOPES = [
  { key: 'mine', label: 'lists.scopes.mine', ready: true },
  { key: 'following', label: 'lists.scopes.friends', ready: false },
  { key: 'collaborative', label: 'lists.scopes.collaborative', ready: false },
] as const;

/** Human copy for each visibility. */
const VISIBILITY_HELP_KEYS = {
  public: 'lists.visibilityHelp.public',
  followers: 'lists.visibilityHelp.followers',
  private: 'lists.visibilityHelp.private',
} as const satisfies Record<Visibility, string>;

function ListsPage() {
  const { t } = useTranslation();
  const { isPending, navUser } = useAuthedPage();
  const { data: lists, isError } = useLists();
  const [creating, setCreating] = useState(false);

  if (isPending || !navUser) return <div className="min-h-screen bg-ink" />;

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        <AppNav user={navUser} />
        <main className="mx-auto flex max-w-[1360px] flex-col gap-7 px-10 pt-12 pb-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h1 className="font-heading text-[64px] leading-none uppercase">{t('lists.title')}</h1>
            <Button onClick={() => setCreating(true)}>{t('lists.newList')}</Button>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {SCOPES.map((scope) =>
              scope.ready ? (
                <Chip key={scope.key} selected>
                  {t(scope.label)}
                </Chip>
              ) : (
                <Tooltip key={scope.key} label={t('common.comingSoon')}>
                  <span
                    tabIndex={0}
                    className="cursor-not-allowed rounded-full border border-glass-border bg-glass px-4 py-2 font-label text-xs font-semibold tracking-label text-dim/60"
                  >
                    {t(scope.label)}
                  </span>
                </Tooltip>
              ),
            )}
          </div>

          {isError ? (
            <p role="alert" className="text-[15px] text-red-400">
              {t('lists.error')}
            </p>
          ) : lists === undefined ? (
            <div className="h-40" aria-busy />
          ) : lists.length === 0 ? (
            <GlassCard className="px-6 py-5 text-[15px] text-muted">{t('lists.empty')}</GlassCard>
          ) : (
            <ul className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {lists.map((entry) => (
                <li key={entry.id}>
                  <ListCard list={entry} />
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>
      {creating && <NewListDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

/**
 * A list card: a fan of up to four covers over the title, badges and meta row.
 * The fan uses `coverGradient` directly rather than `CoverCard`, which is locked
 * to a 2/3 aspect with a title overlay, which is wrong for bare slabs.
 */
function ListCard({ list }: { list: ListSummary }) {
  const { t } = useTranslation();
  const labels = useLabels();
  const format = useFormat();
  return (
    <Link to="/lists/$id" params={{ id: list.id }} className="block">
      <GlassCard className="overflow-hidden transition hover:border-pink">
        <div className="flex h-[170px]" aria-hidden>
          {list.covers.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-sm text-faint">
              {t('lists.card.emptyCover')}
            </div>
          ) : (
            list.covers.map((cover, index) => (
              <div
                key={`${cover.title}-${index}`}
                className="flex-1 border-r border-ink/60 last:border-r-0"
                style={{ background: coverGradient(cover.kind, cover.title) }}
              />
            ))
          )}
        </div>
        <div className="flex flex-col gap-2 px-6 py-5">
          <div className="flex items-center gap-2.5">
            <h2 className="flex-1 font-heading text-[22px] leading-tight uppercase">
              {list.title}
            </h2>
            {list.isRanked && <Badge tone="pink">{t('lists.card.ranked')}</Badge>}
            {list.isCollaborative && <Badge tone="muted">{t('lists.card.collab')}</Badge>}
          </div>
          {list.description && (
            <p className="text-sm leading-relaxed text-muted">{list.description}</p>
          )}
          <div className="mt-1 flex flex-wrap gap-3.5 font-label text-xs tracking-label text-dim">
            <span>{t('lists.titles', { count: list.itemCount })}</span>
            <span>{labels.visibility(list.visibility)}</span>
            <span>{t('lists.updated', { date: format.updated(list.updatedAt) })}</span>
          </div>
        </div>
      </GlassCard>
    </Link>
  );
}

function Badge({ tone, children }: { tone: 'pink' | 'muted'; children: string }) {
  return (
    <span
      className={
        tone === 'pink'
          ? 'rounded-full border border-pink px-2.5 py-0.5 font-label text-[10px] font-bold tracking-label text-pink'
          : 'rounded-full border border-white/20 px-2.5 py-0.5 font-label text-[10px] font-bold tracking-label text-muted'
      }
    >
      {children}
    </span>
  );
}

function NewListDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const labels = useLabels();
  const createList = useCreateList();
  const navigate = Route.useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isRanked, setIsRanked] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    createList.mutate(
      {
        title: title.trim(),
        description: description.trim() || null,
        isRanked,
        visibility,
      },
      {
        onSuccess: (created) => navigate({ to: '/lists/$id', params: { id: created.id } }),
        onError: (cause) => setError(cause.message || t('lists.dialog.saveError')),
      },
    );
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <ModalTitle>{t('lists.dialog.title')}</ModalTitle>

        <Input
          label={t('lists.dialog.titleLabel')}
          name="title"
          value={title}
          maxLength={120}
          required
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t('lists.dialog.titlePlaceholder')}
        />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="list-description"
            className="font-label text-xs font-semibold tracking-label text-dim uppercase"
          >
            {t('lists.dialog.descriptionLabel')}
          </label>
          <textarea
            id="list-description"
            value={description}
            maxLength={500}
            rows={3}
            onChange={(event) => setDescription(event.target.value)}
            className="rounded-card-sm border border-glass-border-strong bg-glass-well px-4 py-3 text-[15px] outline-none placeholder:text-dim focus:border-pink"
            placeholder={t('lists.dialog.descriptionPlaceholder')}
          />
          <p className="text-right text-xs text-faint">{description.length}/500</p>
        </div>

        <label className="flex items-center gap-3 text-[15px]">
          <input
            type="checkbox"
            checked={isRanked}
            onChange={(event) => setIsRanked(event.target.checked)}
            className="size-4 accent-pink"
          />
          {t('lists.dialog.ranked')}
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="font-label text-xs font-semibold tracking-label text-dim uppercase">
            {t('lists.dialog.visibility')}
          </span>
          <div className="flex flex-wrap gap-2.5">
            {VISIBILITIES.map((value) => (
              <Chip
                key={value}
                type="button"
                selected={visibility === value}
                onClick={() => setVisibility(value)}
              >
                {labels.visibility(value)}
              </Chip>
            ))}
          </div>
          <p className="text-xs text-faint">{t(VISIBILITY_HELP_KEYS[visibility])}</p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={createList.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={createList.isPending || title.trim().length === 0}>
            {createList.isPending ? t('lists.dialog.creating') : t('lists.dialog.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
