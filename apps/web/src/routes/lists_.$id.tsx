import { createFileRoute, Link } from '@tanstack/react-router';
import { Trans, useTranslation } from 'react-i18next';
import { useRef, useState } from 'react';
import type { ListDetail, ListEntry, MediaStatus } from '@trackt/shared';
import { AppNav, type AppNavUser } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { Button } from '../components/ui/Button';
import { GlassCard } from '../components/ui/GlassCard';
import { KindDot } from '../components/ui/KindDot';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { FlagGate } from '../components/ui/FlagGate';
import { useAuthedPage } from '../lib/auth-client';
import { useFormat } from '../lib/format';
import { useLabels } from '../lib/labels';
import { coverGradient, listsApi, useFlag, useList, useListsInvalidator } from '@trackt/client';

export const Route = createFileRoute('/lists_/$id')({
  head: ({ match }) => ({ meta: [{ title: match.context.i18n.t('lists.detailTitle') }] }),
  component: ListDetailPage,
});

const MEDIA_STATUS_KEYS = {
  announced: 'lists.detail.mediaStatus.announced',
  airing: 'lists.detail.mediaStatus.airing',
  publishing: 'lists.detail.mediaStatus.publishing',
  ended: 'lists.detail.mediaStatus.ended',
  cancelled: 'lists.detail.mediaStatus.cancelled',
} as const satisfies Record<MediaStatus, string>;

function ListDetailPage() {
  const { t } = useTranslation();
  const labels = useLabels();
  const format = useFormat();
  const { id } = Route.useParams();
  const navigate = Route.useNavigate();
  const { isPending: authPending, navUser } = useAuthedPage();
  const listsOn = useFlag('lists.custom');
  const { data, isError, refetch } = useList(id);
  const invalidate = useListsInvalidator();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Guards re-entrant mutations without disabling the button that triggered
  // them; see the ↑/↓ note in ListRow.
  const inFlight = useRef(false);

  if (authPending || !navUser) return <div className="min-h-screen bg-ink" />;

  if (!listsOn) {
    return (
      <Shell user={navUser}>
        <FlagGate
          flag="lists.custom"
          title={t('lists.unavailableTitle')}
          body={t('lists.unavailableBody')}
        />
      </Shell>
    );
  }

  if (isError) {
    return (
      <Shell user={navUser}>
        <h1 className="font-heading text-[56px] leading-none uppercase">
          {t('lists.detail.loadFailedTitle')}
        </h1>
        <p className="max-w-[540px] text-[15px] text-muted">{t('lists.detail.loadFailedBody')}</p>
        <div className="mt-2 flex items-center gap-5">
          <Button onClick={() => refetch()}>{t('lists.detail.retry')}</Button>
          <Link to="/lists" className="text-sm font-bold text-pink">
            {t('lists.detail.allLists')}
          </Link>
        </div>
      </Shell>
    );
  }

  if (data === null) {
    return (
      <Shell user={navUser}>
        <h1 className="font-heading text-[56px] leading-none uppercase">
          {t('lists.detail.notFoundTitle')}
        </h1>
        <p className="text-[15px] text-muted">{t('lists.detail.notFoundBody')}</p>
        <Link to="/lists" className="text-sm font-bold text-pink">
          {t('lists.detail.allLists')}
        </Link>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell user={navUser}>
        <div className="h-40" aria-busy />
      </Shell>
    );
  }

  const list: ListDetail = data;

  /** Every mutation re-reads from the server; positions and counts are its call. */
  const run = async (action: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      invalidate(list.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('lists.detail.saveError'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Shell user={navUser}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Link to="/lists" className="font-label text-xs tracking-label text-dim hover:text-pink">
            {t('lists.detail.allLists')}
          </Link>
          <h1 className="font-heading text-[56px] leading-none uppercase">{list.title}</h1>
          {list.description && (
            <p className="max-w-[640px] text-[15px] leading-relaxed text-muted">
              {list.description}
            </p>
          )}
          <div className="flex flex-wrap gap-3.5 font-label text-xs tracking-label text-dim">
            <span>{t('lists.titles', { count: list.entries.length })}</span>
            <span>{labels.visibility(list.visibility)}</span>
            <span>{t('lists.updated', { date: format.updated(list.updatedAt) })}</span>
            {!list.isOwner && (
              <span>
                <Trans
                  i18nKey="lists.detail.by"
                  values={{ username: list.owner.username }}
                  components={{
                    user: (
                      <Link
                        to="/users/$username"
                        params={{ username: list.owner.username }}
                        className="hover:text-pink"
                      />
                    ),
                  }}
                />
              </span>
            )}
          </div>
        </div>
        {list.isOwner && (
          <Button variant="ghost" onClick={() => setConfirmingDelete(true)} disabled={busy}>
            {t('lists.detail.deleteList')}
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="flex items-baseline gap-4">
        <h2 className="font-heading text-[32px] uppercase">
          {list.isRanked ? t('lists.detail.ranked') : t('lists.detail.titles')}
        </h2>
        {list.isRanked && list.isOwner && list.entries.length > 1 && (
          <span className="font-label text-[13px] tracking-label text-dim">
            {t('lists.detail.reorderHint')}
          </span>
        )}
      </div>

      {list.entries.length === 0 ? (
        <GlassCard className="px-6 py-5 text-[15px] text-muted">
          {t('lists.detail.empty')}
        </GlassCard>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.entries.map((entry, index) => (
            <ListRow
              key={entry.id}
              entry={entry}
              index={index}
              total={list.entries.length}
              ranked={list.isRanked}
              owner={list.isOwner}
              busy={busy}
              onMove={(direction) => run(() => listsApi.moveItem(list.id, entry.id, direction))}
              onRemove={() => run(() => listsApi.removeItem(list.id, entry.id))}
            />
          ))}
        </ul>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title={t('lists.delete.title')}
          confirmLabel={busy ? t('lists.delete.confirming') : t('lists.delete.confirm')}
          busy={busy}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() =>
            run(async () => {
              await listsApi.remove(list.id);
              await navigate({ to: '/lists' });
            })
          }
        >
          <Trans
            i18nKey="lists.delete.body"
            count={list.entries.length}
            values={{ title: list.title }}
          />
        </ConfirmDialog>
      )}
    </Shell>
  );
}

function ListRow({
  entry,
  index,
  total,
  ranked,
  owner,
  busy,
  onMove,
  onRemove,
}: {
  entry: ListEntry;
  index: number;
  total: number;
  ranked: boolean;
  owner: boolean;
  busy: boolean;
  onMove: (direction: 'up' | 'down') => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const format = useFormat();
  const meta = [
    labels.kindSingular(entry.kind),
    entry.seasonNumber !== null ? t('lists.detail.season', { number: entry.seasonNumber }) : null,
    entry.year !== null ? String(entry.year) : null,
    entry.status !== null ? t(MEDIA_STATUS_KEYS[entry.status]) : null,
  ].filter(Boolean);

  return (
    <GlassCard as="li" className="flex items-center gap-4.5 rounded-card-sm px-4.5 py-3">
      {ranked && (
        <span className="w-10 shrink-0 text-prism font-display text-2xl">
          {String(index + 1).padStart(2, '0')}
        </span>
      )}
      <span
        aria-hidden
        className="h-[62px] w-11 shrink-0 rounded-thumb"
        style={{ background: coverGradient(entry.kind, entry.title) }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          to="/media/$slug"
          params={{ slug: entry.slug }}
          className="truncate text-[15px] font-bold hover:text-pink"
        >
          {entry.title}
        </Link>
        <span className="mt-0.5 flex items-center gap-2 font-label text-xs tracking-label text-dim">
          <KindDot kind={entry.kind} />
          {meta.join(' · ')}
        </span>
      </div>
      {entry.ownerScore !== null && (
        <span className="font-label text-[13px] font-semibold text-pink">
          {format.score(entry.ownerScore)}
        </span>
      )}
      {owner && (
        <div className="flex shrink-0 items-center gap-1">
          {ranked && (
            <>
              {/* Bounds only, never `busy`: the page advertises ↑/↓ reordering,
                  and disabling the button the user just pressed hands focus
                  back to <body>, so the second press then goes nowhere and a
                  keyboard reorder costs a Tab per step. `run()` ignores
                  re-entrant calls instead. */}
              <RowButton
                label={t('lists.detail.moveUp', { title: entry.title })}
                disabled={index === 0}
                onClick={() => onMove('up')}
              >
                ↑
              </RowButton>
              <RowButton
                label={t('lists.detail.moveDown', { title: entry.title })}
                disabled={index === total - 1}
                onClick={() => onMove('down')}
              >
                ↓
              </RowButton>
            </>
          )}
          <RowButton
            label={t('lists.detail.remove', { title: entry.title })}
            disabled={busy}
            onClick={onRemove}
          >
            ✕
          </RowButton>
        </div>
      )}
    </GlassCard>
  );
}

/** Square icon control: the accessible stand-in for the mockup's drag handle. */
function RowButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 cursor-pointer items-center justify-center rounded-full border border-glass-border text-sm text-dim transition hover:border-pink hover:text-pink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-glass-border disabled:hover:text-dim"
    >
      {children}
    </button>
  );
}

function Shell({ user, children }: { user: AppNavUser; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        <AppNav user={user} />
        <main className="mx-auto flex max-w-[1360px] flex-col gap-6 px-10 pt-12 pb-20">
          {children}
        </main>
      </div>
    </div>
  );
}
