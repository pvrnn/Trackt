import * as Dialog from '@radix-ui/react-dialog';
import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { AnimatePresence, m, type Variants } from 'motion/react';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MediaKind, UserSearchResult } from '@trackt/shared';
import {
  useDebounced,
  useImportSources,
  useSendFriendRequest,
  useStartImport,
  useUserSearch,
  type ImportFileInput,
} from '@trackt/client';
import { useLabels } from '../../lib/labels';
import { Avatar } from '../ui/Avatar';
import { BrandTile, type Brand } from '../ui/BrandLogo';
import { kindDotClass } from '../ui/KindDot';
import { Bone, SkeletonRegion } from '../ui/Skeleton';

type FileSourceId = 'tvtime' | 'netflix';
type ProfileSourceId = 'letterboxd' | 'mal' | 'anilist' | 'steam';
type OnboardingSourceId = FileSourceId | ProfileSourceId;

/** What the viewer connected in step 1, in the shape `useStartImport` takes. */
type OnboardingImport =
  | { source: OnboardingSourceId; profile: string }
  | { source: OnboardingSourceId; files: ImportFileInput[] };

/** `how` mirrors the registry's `access`: only a file source reads an upload. */
type Source =
  | { id: FileSourceId; name: string; brand: Brand; kinds: MediaKind[]; how: 'file' }
  | { id: ProfileSourceId; name: string; brand: Brand; kinds: MediaKind[]; how: 'profile' };

const SOURCES: Source[] = [
  { id: 'tvtime', name: 'TV Time', brand: 'tvtime', kinds: ['series', 'movie'], how: 'file' },
  { id: 'netflix', name: 'Netflix', brand: 'netflix', kinds: ['series', 'movie'], how: 'file' },
  { id: 'letterboxd', name: 'Letterboxd', brand: 'letterboxd', kinds: ['movie'], how: 'profile' },
  {
    id: 'mal',
    name: 'MyAnimeList',
    brand: 'myanimelist',
    kinds: ['anime', 'manga'],
    how: 'profile',
  },
  { id: 'anilist', name: 'AniList', brand: 'anilist', kinds: ['anime', 'manga'], how: 'profile' },
  { id: 'steam', name: 'Steam', brand: 'steam', kinds: ['game'], how: 'profile' },
];

const STEPS = ['import', 'friends', 'done'] as const;
type Step = (typeof STEPS)[number];

const SLIDE_PX = 48;
const slide: Variants = {
  enter: (dir: number) => ({ x: dir * SLIDE_PX, opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { duration: 0.28, ease: [0.2, 0.8, 0.2, 1] } },
  exit: (dir: number) => ({
    x: dir * -SLIDE_PX,
    opacity: 0,
    transition: { duration: 0.16, ease: [0.4, 0, 1, 1] },
  }),
};

/** Same accept list as the profile's import wizard. */
const EXPORT_ACCEPT = '.json,.html,.htm,.csv,.zip,application/json,text/html,text/csv';

/**
 * The first-run layer over Home (docs/design/Onboarding.dc.html): import, find
 * friends, done. Connecting a source queues its import on the spot; friend
 * requests go out on Continue.
 */
export function OnboardingDialog({ username, onClose }: { username: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('import');
  /** +1 forward, -1 back: which side the next step slides in from. */
  const [dir, setDir] = useState(1);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Imports already queued; there is no cancelling one, so a row never goes back. */
  const [imports, setImports] = useState<Partial<Record<OnboardingSourceId, OnboardingImport>>>({});
  /** A username typed but not yet added; a key present means that row's field is open. */
  const [drafts, setDrafts] = useState<Partial<Record<ProfileSourceId, string>>>({});
  const startImport = useStartImport();
  const { data: instance } = useImportSources();
  // Until the instance answers, every source shows; once it does, only what it can run.
  const sources = instance
    ? SOURCES.filter(
        (source) => instance.sources.find((status) => status.id === source.id)?.available,
      )
    : SOURCES;
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Map<string, UserSearchResult>>(new Map());
  const [requested, setRequested] = useState<Map<string, UserSearchResult>>(new Map());
  const [sendError, setSendError] = useState(false);
  const sendRequest = useSendFriendRequest();
  const [sending, setSending] = useState(false);

  const idx = STEPS.indexOf(step);
  const connected = SOURCES.filter((source) => imports[source.id]);
  const picked = step === 'import' ? connected.length > 0 : selected.size > 0 || requested.size > 0;
  const close = onClose;

  const go = (next: Step) => {
    if (next === step) return;
    setSendError(false);
    setDir(STEPS.indexOf(next) > STEPS.indexOf(step) ? 1 : -1);
    setStep(next);
  };

  const sendSelected = async () => {
    setSending(true);
    setSendError(false);
    const people = [...selected.values()];
    const results = await Promise.allSettled(
      people.map((person) => sendRequest.mutateAsync(person.username)),
    );
    setSending(false);
    const failed = new Map<string, UserSearchResult>();
    const succeeded = new Map(requested);
    results.forEach((result, i) => {
      const person = people[i]!;
      (result.status === 'rejected' ? failed : succeeded).set(person.id, person);
    });
    setRequested(succeeded);
    setSelected(failed);
    if (failed.size > 0) setSendError(true);
    else go('done');
  };

  const next = () => {
    if (!picked || sending) return;
    if (step === 'friends' && selected.size > 0) void sendSelected();
    else go(STEPS[idx + 1]!);
  };

  const footNote =
    step === 'import' && connected.length > 0
      ? t('onboarding.import.foot', { count: connected.length })
      : step === 'friends' && selected.size > 0
        ? t('onboarding.friends.foot', { count: selected.size })
        : step === 'friends' && requested.size > 0
          ? t('onboarding.friends.sentFoot', { count: requested.size })
          : '';

  const nextLabel = sending
    ? t('onboarding.friends.sending')
    : step === 'friends' && selected.size > 0
      ? t('onboarding.friends.send', { count: selected.size })
      : t('onboarding.continue');

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-60 bg-[rgb(8_6_12/0.74)] backdrop-blur-[10px]" />
        <Dialog.Content
          aria-describedby="onboarding-lede"
          // Focus the sheet, not the first stepper tab, so the dialog opens without a focus ring.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus();
          }}
          // The backdrop is part of the content box, so a stray click on it cannot dismiss setup.
          className="dialog-content fixed inset-0 z-60 flex overflow-y-auto p-3 outline-none sm:p-8"
        >
          <div className="m-auto flex max-h-full min-h-[min(660px,100%)] w-full max-w-[720px] flex-col overflow-hidden rounded-[22px] bg-[#17131d] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12),0_50px_120px_-30px_rgb(0_0_0/0.95)]">
            <div className="flex items-center gap-4 pt-3.5 pr-3 pl-5 sm:pr-4.5 sm:pl-8">
              <div className="min-w-0 flex-1 truncate font-label text-xs font-bold tracking-[0.1em] text-dim">
                {t('onboarding.stepOf', { n: idx + 1, total: STEPS.length })}{' '}
                <span className="text-fg">· {t(`onboarding.stepNames.${step}`)}</span>
              </div>
              <Dialog.Close
                aria-label={t('onboarding.close')}
                title={t('onboarding.closeHint')}
                className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/6 text-[13px] leading-none text-[#cfc9d8] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)] transition hover:bg-white/12 hover:text-fg"
              >
                ✕
              </Dialog.Close>
            </div>
            <ol className="flex gap-2 px-5 pt-3 sm:px-8">
              {STEPS.map((s, i) => (
                <li key={s} className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => go(s)}
                    aria-current={i === idx ? 'step' : undefined}
                    aria-label={t(`onboarding.steps.${s}`)}
                    className="tap-area block w-full cursor-pointer py-2"
                  >
                    <span
                      aria-hidden
                      className="block h-1 overflow-hidden rounded-full bg-white/12"
                    >
                      <span
                        className={clsx(
                          'block h-full origin-left bg-prism transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none',
                          i <= idx ? 'scale-x-100' : 'scale-x-0',
                        )}
                      />
                    </span>
                  </button>
                </li>
              ))}
            </ol>

            <div
              ref={bodyRef}
              className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-5 pt-4.5 pb-6 sm:px-8"
            >
              <AnimatePresence
                mode="wait"
                initial={false}
                custom={dir}
                onExitComplete={() => bodyRef.current?.scrollTo({ top: 0 })}
              >
                <m.div
                  key={step}
                  custom={dir}
                  variants={slide}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="flex flex-col gap-5.5"
                >
                  <div className="flex flex-col gap-2.5">
                    <Dialog.Title asChild>
                      <h1 className="font-heading text-[clamp(36px,5vw,48px)] leading-[0.96] uppercase">
                        {t(`onboarding.${step}.title`)}
                      </h1>
                    </Dialog.Title>
                    <p
                      id="onboarding-lede"
                      className="max-w-[54ch] text-base leading-relaxed text-pretty text-muted"
                    >
                      {t(`onboarding.${step}.lede`)}
                    </p>
                  </div>

                  {step === 'import' && (
                    <ul className="flex flex-col gap-2">
                      {sources.map((source) => (
                        <SourceRow
                          key={source.id}
                          source={source}
                          value={imports[source.id]}
                          onConnect={async (value) => {
                            await startImport.mutateAsync(value);
                            setImports((current) => ({ ...current, [source.id]: value }));
                          }}
                          draft={source.how === 'profile' ? drafts[source.id] : undefined}
                          onDraft={(draft) =>
                            setDrafts((current) => ({ ...current, [source.id]: draft }))
                          }
                        />
                      ))}
                    </ul>
                  )}

                  {step === 'friends' && (
                    <FriendsStep
                      username={username}
                      query={query}
                      onQuery={setQuery}
                      selected={selected}
                      requested={requested}
                      onToggle={(person) =>
                        setSelected((current) => {
                          const nextSet = new Map(current);
                          if (nextSet.has(person.id)) nextSet.delete(person.id);
                          else nextSet.set(person.id, person);
                          return nextSet;
                        })
                      }
                      error={sendError}
                    />
                  )}

                  {step === 'done' && (
                    <div className="flex flex-col gap-4.5">
                      <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(190px,100%),1fr))] rounded-2xl bg-white/5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)]">
                        <Recap
                          label={t('onboarding.done.sources')}
                          value={connected.length}
                          note={
                            connected.length > 0
                              ? t('onboarding.done.sourcesNote', {
                                  names: connected.map((source) => source.name).join(', '),
                                })
                              : t('onboarding.done.sourcesNone')
                          }
                        />
                        <Recap
                          label={t('onboarding.done.requests')}
                          value={requested.size}
                          note={
                            requested.size > 0
                              ? t('onboarding.done.requestsNote')
                              : t('onboarding.done.requestsNone')
                          }
                        />
                      </dl>
                      <p className="text-sm leading-relaxed text-muted">
                        {connected.length > 0
                          ? t('onboarding.done.noteImport')
                          : t('onboarding.done.noteEmpty')}
                      </p>
                    </div>
                  )}
                </m.div>
              </AnimatePresence>
            </div>

            <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.09)] sm:px-8">
              {idx > 0 && (
                <FooterButton onClick={() => go(STEPS[idx - 1]!)}>
                  <span aria-hidden>←</span>
                  {t('onboarding.back')}
                </FooterButton>
              )}
              <div className="min-w-0 flex-1 font-label text-[11px] font-medium tracking-[0.06em] text-dim">
                {footNote}
              </div>
              {step !== 'done' ? (
                <>
                  <button
                    type="button"
                    onClick={() => go(STEPS[idx + 1]!)}
                    className="h-12 cursor-pointer px-3.5 text-[13px] font-bold tracking-[0.06em] text-[#cfc9d8] underline decoration-white/30 underline-offset-[5px] transition hover:text-fg"
                  >
                    {t('onboarding.skip')}
                  </button>
                  <button
                    type="button"
                    onClick={next}
                    aria-disabled={!picked || sending}
                    className={clsx(
                      'flex h-12 items-center gap-2.5 rounded-full px-6.5 text-[13px] font-bold tracking-[0.06em] whitespace-nowrap transition',
                      picked && !sending
                        ? 'cursor-pointer bg-prism text-on-prism hover:brightness-112'
                        : 'cursor-not-allowed bg-white/7 text-dim',
                    )}
                  >
                    <span>{nextLabel}</span>
                    <span aria-hidden>→</span>
                  </button>
                </>
              ) : (
                <>
                  <Link
                    to="/search"
                    onClick={close}
                    className="flex h-12 items-center rounded-full px-5.5 text-[13px] font-bold tracking-[0.06em] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18)] transition hover:shadow-[inset_0_0_0_1px_var(--color-pink)]"
                  >
                    {t('onboarding.done.addTitle')}
                  </Link>
                  <button
                    type="button"
                    onClick={close}
                    className="flex h-12 cursor-pointer items-center gap-2.5 rounded-full bg-prism px-6.5 text-[13px] font-bold tracking-[0.06em] text-on-prism transition hover:brightness-112"
                  >
                    <span>{t('onboarding.done.home')}</span>
                    <span aria-hidden>→</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FooterButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 cursor-pointer items-center gap-2 rounded-full px-5 text-[13px] font-bold tracking-[0.06em] text-fg shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18)] transition hover:shadow-[inset_0_0_0_1px_var(--color-pink)]"
    >
      {children}
    </button>
  );
}

function Recap({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-4.5">
      <dt className="font-label text-[10px] font-bold tracking-[0.12em] text-dim">{label}</dt>
      <dd className="w-fit text-prism font-heading text-[34px] leading-none">{value}</dd>
      <dd className="text-[13px] text-muted">{note}</dd>
    </div>
  );
}

const pillClass =
  'flex h-10.5 shrink-0 cursor-pointer items-center justify-center rounded-full px-3.5 text-xs font-bold tracking-[0.06em] whitespace-nowrap transition';

function SourceRow({
  source,
  value,
  onConnect,
  draft,
  onDraft,
}: {
  source: Source;
  value: OnboardingImport | undefined;
  /** Queues the import; rejects with the instance's reason when it refuses. */
  onConnect: (value: OnboardingImport) => Promise<void>;
  draft: string | undefined;
  onDraft: (draft: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const editing = draft !== undefined;
  const profile = draft ?? '';
  const [reading, setReading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const done = value !== undefined;
  const busy = reading || starting;

  const connect = async (next: OnboardingImport): Promise<boolean> => {
    setReadError(null);
    setStarting(true);
    try {
      await onConnect(next);
      return true;
    } catch (error) {
      setReadError(error instanceof Error ? error.message : t('onboarding.import.startError'));
      return false;
    } finally {
      setStarting(false);
    }
  };

  const readFiles = async (list: FileList | null) => {
    const chosen = [...(list ?? [])];
    if (chosen.length === 0) return;
    setReadError(null);
    setReading(true);
    const files: ImportFileInput[] = [];
    for (const file of chosen) {
      try {
        files.push({ name: file.name, content: await file.text() });
      } catch {
        setReading(false);
        setReadError(t('onboarding.import.readError', { name: file.name }));
        return;
      }
    }
    setReading(false);
    await connect({ source: source.id, files });
  };

  const submitProfile = async () => {
    const trimmed = profile.trim();
    if (!trimmed || busy) return;
    if (await connect({ source: source.id, profile: trimmed })) onDraft(undefined);
  };

  const note = readError
    ? readError
    : reading
      ? t('onboarding.import.reading')
      : starting
        ? t('onboarding.import.starting')
        : value && 'profile' in value
          ? value.profile
          : value && 'files' in value
            ? t('onboarding.import.files', {
                count: value.files.length,
                names: value.files.map((file) => file.name).join(', '),
              })
            : t(`onboarding.import.sources.${source.id}.idle`);

  return (
    <li
      className={clsx(
        'flex flex-col gap-3 rounded-[14px] py-3 pr-3.5 pl-3 transition',
        done
          ? 'bg-pink/10 shadow-[inset_0_0_0_1px_rgb(217_107_176/0.55)]'
          : 'bg-white/5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)]',
      )}
    >
      <div className="flex items-center gap-3.5">
        <BrandTile brand={source.brand} className="size-11 rounded-xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.25">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-base font-bold">{source.name}</span>
            <span className="flex flex-wrap gap-x-2.5 gap-y-1">
              {source.kinds.map((kind) => (
                <span key={kind} className="flex items-center gap-1.25">
                  <span aria-hidden className={clsx('size-1.5 rounded-full', kindDotClass[kind])} />
                  <span className="font-label text-[10px] font-bold tracking-[0.1em] text-muted uppercase">
                    {labels.kind(kind)}
                  </span>
                </span>
              ))}
            </span>
          </div>
          <div
            role={readError ? 'alert' : undefined}
            className={clsx(
              'truncate text-[13px]',
              readError ? 'text-red-400' : done ? 'text-[#e58cc4]' : 'text-muted',
              busy && 'animate-pulse',
            )}
          >
            {note}
          </div>
        </div>

        {done ? (
          <span className="flex h-10.5 shrink-0 items-center justify-center gap-1.5 rounded-full bg-pink/16 px-4 text-xs font-bold tracking-[0.06em] whitespace-nowrap text-[#e58cc4] shadow-[inset_0_0_0_1px_rgb(217_107_176/0.55)] sm:w-40">
            <span aria-hidden>✓</span>
            {t('onboarding.import.connected')}
          </span>
        ) : source.how === 'file' ? (
          <label
            className={clsx(
              pillClass,
              'bg-white/6 text-fg shadow-[inset_0_0_0_1px_rgb(255_255_255/0.22)] focus-within:shadow-[inset_0_0_0_1px_var(--color-pink)] hover:shadow-[inset_0_0_0_1px_var(--color-pink)] sm:w-40 sm:px-0',
            )}
          >
            {t('onboarding.import.upload')}
            <input
              type="file"
              multiple
              accept={EXPORT_ACCEPT}
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                void readFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </label>
        ) : (
          !editing && (
            <button
              type="button"
              onClick={() => onDraft('')}
              className={clsx(
                pillClass,
                'bg-white/6 text-fg shadow-[inset_0_0_0_1px_rgb(255_255_255/0.22)] hover:shadow-[inset_0_0_0_1px_var(--color-pink)] sm:w-40 sm:px-0',
              )}
            >
              {t('onboarding.import.connect')}
            </button>
          )
        )}
      </div>

      {!done && editing && source.how === 'profile' && (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submitProfile();
          }}
        >
          <label className="flex min-w-0 flex-1 items-center rounded-xl bg-white/6 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)] transition focus-within:shadow-[inset_0_0_0_1px_var(--color-pink),0_0_0_4px_rgb(217_107_176/0.16)]">
            <input
              autoFocus
              value={profile}
              onChange={(event) => onDraft(event.target.value)}
              aria-label={t(`onboarding.import.sources.${source.id}.placeholder`)}
              placeholder={t(`onboarding.import.sources.${source.id}.placeholder`)}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent px-3.5 py-2.5 text-base text-fg outline-none placeholder:text-dim sm:text-[15px]"
            />
          </label>
          <button
            type="submit"
            aria-disabled={!profile.trim() || busy}
            className={clsx(
              pillClass,
              'sm:px-4.5',
              profile.trim() && !busy
                ? 'bg-fg text-on-prism hover:brightness-90'
                : 'cursor-not-allowed bg-white/7 text-dim',
            )}
          >
            {t('onboarding.import.add')}
          </button>
          <button
            type="button"
            onClick={() => onDraft(undefined)}
            aria-label={t('common.cancel')}
            className="flex size-10.5 shrink-0 cursor-pointer items-center justify-center rounded-full text-xs text-muted shadow-[inset_0_0_0_1px_rgb(255_255_255/0.16)] transition hover:text-fg"
          >
            ✕
          </button>
        </form>
      )}
    </li>
  );
}

function FriendsStep({
  username,
  query,
  onQuery,
  selected,
  requested,
  onToggle,
  error,
}: {
  username: string;
  query: string;
  onQuery: (query: string) => void;
  selected: Map<string, UserSearchResult>;
  requested: Map<string, UserSearchResult>;
  onToggle: (person: UserSearchResult) => void;
  error: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const debounced = useDebounced(query).trim();
  const searching = debounced.length >= 2;
  const { data: results, isFetching, isError } = useUserSearch(debounced);

  const invite = async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/users/${encodeURIComponent(username)}`,
      );
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const people = searching
    ? (results ?? []).filter((person) => person.friendState !== 'self')
    : [...requested.values(), ...selected.values()];

  return (
    <div className="flex flex-col gap-3.5">
      <label className="flex items-center rounded-xl bg-white/6 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)] transition focus-within:shadow-[inset_0_0_0_1px_var(--color-pink),0_0_0_4px_rgb(217_107_176/0.16)]">
        <span aria-hidden className="pl-4 text-base text-dim">
          ⌕
        </span>
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          aria-label={t('onboarding.friends.search')}
          placeholder={t('social.searchPlaceholder')}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent px-3 py-3.5 text-base text-fg outline-none placeholder:text-dim"
        />
        <button
          type="button"
          onClick={() => void invite()}
          className={clsx(
            'cursor-pointer px-4 py-3.5 font-label text-[11px] font-bold tracking-[0.08em] whitespace-nowrap transition hover:text-pink',
            copied ? 'text-[#e58cc4]' : 'text-muted',
          )}
        >
          {copied ? t('onboarding.friends.copied') : t('onboarding.friends.invite')}
        </button>
      </label>

      {people.length > 0 && (
        <div className="font-label text-[11px] font-bold tracking-[0.12em] text-dim">
          {searching ? t('onboarding.friends.results') : t('onboarding.friends.selected')}
        </div>
      )}

      {searching && isError ? (
        <p role="alert" className="text-[15px] text-red-400">
          {t('onboarding.friends.searchFailed')}
        </p>
      ) : searching && isFetching && people.length === 0 ? (
        <SkeletonRegion as="ul" className="flex flex-col">
          {Array.from({ length: 3 }, (_, index) => (
            <li
              key={index}
              aria-hidden
              className="flex items-center gap-3.5 py-2.75 shadow-[inset_0_-1px_0_rgb(255_255_255/0.08)]"
            >
              <Bone className="size-9 shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Bone className="h-4 w-2/5" />
                <Bone className="h-2.5 w-1/4" />
              </div>
              <Bone className="h-10 w-24 rounded-full" />
            </li>
          ))}
        </SkeletonRegion>
      ) : people.length > 0 ? (
        <ul className="flex flex-col">
          {people.map((person) => (
            <PersonRow
              key={person.id}
              person={person}
              picked={selected.has(person.id)}
              requested={requested.has(person.id)}
              onToggle={() => onToggle(person)}
            />
          ))}
        </ul>
      ) : (
        <div className="rounded-[14px] border border-dashed border-white/20 p-5.5 text-sm leading-relaxed text-muted">
          {searching
            ? t('onboarding.friends.noMatches', { query: debounced })
            : t('onboarding.friends.empty')}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {t('onboarding.friends.sendFailed')}
        </p>
      )}
    </div>
  );
}

const STATE_KEY = {
  friends: 'onboarding.friends.already',
  outgoing: 'onboarding.friends.pending',
  incoming: 'onboarding.friends.incoming',
} as const;

function PersonRow({
  person,
  picked,
  requested,
  onToggle,
}: {
  person: UserSearchResult;
  picked: boolean;
  requested: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const settled = person.friendState !== 'none' && person.friendState !== 'self';

  return (
    <li className="flex items-center gap-3.5 py-2.75 shadow-[inset_0_-1px_0_rgb(255_255_255/0.08)]">
      <Avatar name={person.username} src={person.image} size={44} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="truncate text-[15px] font-semibold">
          {person.name}{' '}
          <span className="font-label text-xs font-medium text-dim">@{person.username}</span>
        </div>
      </div>
      {requested ? (
        <span className="flex h-10 shrink-0 items-center px-4 text-xs font-bold tracking-[0.06em] text-[#e58cc4]">
          {t('onboarding.friends.requested')}
        </span>
      ) : settled ? (
        <span className="flex h-10 shrink-0 items-center px-4 font-label text-[11px] font-bold tracking-[0.08em] text-dim">
          {t(STATE_KEY[person.friendState as keyof typeof STATE_KEY])}
        </span>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={picked}
          className={clsx(
            'flex h-10 min-w-[124px] shrink-0 cursor-pointer items-center justify-center rounded-full px-4 text-xs font-bold tracking-[0.06em] whitespace-nowrap transition hover:brightness-90',
            picked
              ? 'bg-pink/16 text-[#e58cc4] shadow-[inset_0_0_0_1px_rgb(217_107_176/0.55)]'
              : 'bg-fg text-on-prism',
          )}
        >
          {picked ? t('onboarding.friends.picked') : t('onboarding.friends.add')}
        </button>
      )}
    </li>
  );
}
