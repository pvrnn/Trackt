import { useRef, useState, type FormEvent } from 'react';
import {
  AVATAR_MIME_TYPES,
  MEDIA_KINDS,
  MEDIA_STATUSES,
  type CreateMediaBody,
  type MediaKind,
  type MediaStatus,
} from '@trackt/shared';
import { createEntry, uploadCover } from '../../lib/entries';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';

/** Series/anime count episodes and carry a season number; manga/webtoon count chapters (ADR-0003). */
const EPISODIC: MediaKind[] = ['series', 'anime'];

const KIND_LABELS: Record<MediaKind, string> = {
  movie: 'MOVIE',
  series: 'SERIES',
  anime: 'ANIME',
  manga: 'MANGA',
  webtoon: 'WEBTOON',
};

/** '12' → 12, '' → undefined; lets the server reject garbage with a message. */
function toCount(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : undefined;
}

/** 'action, drama' → ['action', 'drama'] (undefined when empty). */
function toList(value: string): string[] | undefined {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/**
 * Create-entry dialog (PRD §3.5), launched from the Discover page's
 * "Can't find it?" aside. The new entry starts `unverified`: usable by its
 * creator right away, public once the moderation queue verifies it.
 */
export function CreateEntryDialog({
  initialTitle,
  initialKind,
  onClose,
  onCreated,
}: {
  initialTitle: string;
  initialKind?: MediaKind;
  onClose: () => void;
  onCreated: (slug: string) => void;
}) {
  const [kind, setKind] = useState<MediaKind>(initialKind ?? 'webtoon');
  const [title, setTitle] = useState(initialTitle);
  const [year, setYear] = useState('');
  const [status, setStatus] = useState<'' | MediaStatus>('');
  const [genres, setGenres] = useState('');
  const [synonyms, setSynonyms] = useState('');
  const [partCount, setPartCount] = useState(''); // episodes | chapters
  const [seasonNumber, setSeasonNumber] = useState(''); // series/anime only
  const [description, setDescription] = useState('');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const episodic = EPISODIC.includes(kind);
  const hasParts = kind !== 'movie';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('Title can’t be empty.');
      return;
    }
    const body: CreateMediaBody = {
      kind,
      title: title.trim(),
      year: toCount(year) ?? undefined,
      status: status || undefined,
      genres: toList(genres),
      synonyms: toList(synonyms),
      description: description.trim() || undefined,
      ...(hasParts ? { partCount: toCount(partCount) } : {}),
      ...(episodic ? { seasonNumber: toCount(seasonNumber) } : {}),
    };
    setBusy(true);
    setError(null);
    try {
      const created = await createEntry(body);
      if (coverFile) {
        // Non-fatal: the entry already exists; moderators can fix covers later.
        await uploadCover(created.id, coverFile).catch(() => undefined);
      }
      onCreated(created.slug);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Creation failed — try again.');
      setBusy(false);
    }
  };

  return (
    <Modal label="create entry" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div>
          <h2 className="font-display text-[28px] uppercase">Create entry</h2>
          <p className="mt-1 text-sm text-muted">
            Usable immediately — only you can see it until a moderator verifies it.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-label text-xs font-semibold tracking-label text-dim uppercase">
            Kind
          </span>
          <div className="flex flex-wrap gap-2">
            {MEDIA_KINDS.map((value) => (
              <Chip key={value} selected={kind === value} onClick={() => setKind(value)}>
                {KIND_LABELS[value]}
              </Chip>
            ))}
          </div>
        </div>

        <Input
          label="Title"
          name="title"
          value={title}
          maxLength={300}
          onChange={(event) => setTitle(event.target.value)}
          required
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Year"
            name="year"
            type="number"
            min={1850}
            placeholder="2021"
            value={year}
            onChange={(event) => setYear(event.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="entry-status"
              className="font-label text-xs font-semibold tracking-label text-dim uppercase"
            >
              Status
            </label>
            <select
              id="entry-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as '' | MediaStatus)}
              className="rounded-cover border border-white/12 bg-white/6 px-[18px] py-3.5 font-sans text-[15px] text-fg transition-colors outline-none focus:border-pink/60"
            >
              <option value="">UNKNOWN</option>
              {MEDIA_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        {hasParts && (
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={episodic ? 'Episodes' : 'Chapters'}
              name="partCount"
              type="number"
              min={1}
              value={partCount}
              onChange={(event) => setPartCount(event.target.value)}
            />
            {episodic && (
              <Input
                label="Season number"
                name="seasonNumber"
                type="number"
                min={1}
                value={seasonNumber}
                onChange={(event) => setSeasonNumber(event.target.value)}
              />
            )}
          </div>
        )}

        <Input
          label="Genres"
          name="genres"
          placeholder="action, fantasy (comma-separated)"
          value={genres}
          onChange={(event) => setGenres(event.target.value)}
        />
        <Input
          label="Also known as"
          name="synonyms"
          placeholder="alternative titles (comma-separated)"
          value={synonyms}
          onChange={(event) => setSynonyms(event.target.value)}
        />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="entry-description"
            className="font-label text-xs font-semibold tracking-label text-dim uppercase"
          >
            Description
          </label>
          <textarea
            id="entry-description"
            rows={3}
            maxLength={5000}
            value={description}
            placeholder="What is it about?"
            onChange={(event) => setDescription(event.target.value)}
            className="resize-none rounded-cover border border-white/12 bg-white/6 px-[18px] py-3.5 font-sans text-[15px] text-fg transition-colors outline-none placeholder:text-faint focus:border-pink/60"
          />
        </div>

        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept={AVATAR_MIME_TYPES.join(',')}
            className="hidden"
            onChange={(event) => setCoverFile(event.target.files?.[0] ?? null)}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {coverFile ? 'CHANGE COVER' : 'ADD COVER'}
          </Button>
          {coverFile ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setCoverFile(null);
                if (fileRef.current) fileRef.current.value = '';
              }}
              className="cursor-pointer text-[13px] text-dim transition hover:text-pink"
            >
              {coverFile.name} — remove
            </button>
          ) : (
            <p className="text-xs text-faint">Optional. PNG, JPEG, or WebP — 2MB max.</p>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            CANCEL
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'CREATING…' : 'CREATE ENTRY'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
