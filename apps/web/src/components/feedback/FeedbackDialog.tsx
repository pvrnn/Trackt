import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FEEDBACK_CATEGORIES, type FeedbackCategory } from '@trackt/shared';
import { useSubmitFeedback } from '@trackt/client';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Modal, ModalTitle, MODAL_EXIT_MS } from '../ui/Modal';
import { useToast } from '../ui/Toast';

const CATEGORY_KEYS = {
  bug: 'feedback.category.bug',
  feature: 'feedback.category.feature',
  other: 'feedback.category.other',
} as const satisfies Record<FeedbackCategory, string>;

/**
 * The one feedback surface: category, a message, done. Reports go to the
 * central catalog, so the same inbox serves every deployment: a self-hoster
 * collects suggestions without running anything to receive them.
 *
 * The attached context is named in the dialog rather than collected silently:
 * the instance URL and the page are what make a report reproducible, and nobody
 * should discover after the fact that "feedback" carried metadata. No account
 * identity travels: the instance requires a session, but nothing about the user
 * is forwarded.
 *
 * `media` scopes the same dialog to one work when it is opened from a media
 * page: the copy invites the data problems that page can have, and the id and
 * title ride along so the operator lands on the entry instead of a slug.
 */
export function FeedbackDialog({
  onClose,
  media,
}: {
  onClose: () => void;
  media?: { id: string; title: string };
}) {
  const { t } = useTranslation();
  const submit = useSubmitFeedback();
  const toast = useToast();
  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [message, setMessage] = useState('');
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Close through the animation: flipping `open` plays the fade, and the parent,
   * which owns this component, unmounts it once the fade is over. Every exit
   * goes through here: CANCEL, Escape, backdrop and a successful send.
   */
  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    exitTimer.current = setTimeout(onClose, MODAL_EXIT_MS);
  };

  useEffect(
    () => () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    },
    [],
  );

  const trimmed = message.trim();
  const tooShort = trimmed.length < 10;

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (tooShort) return;
    submit.mutate(
      {
        category,
        message: trimmed,
        // Read at submit time: the reporter may have opened the dialog from
        // one page and navigated while typing it.
        route: `${window.location.pathname}${window.location.search}`,
        ...(media ? { mediaId: media.id, mediaTitle: media.title } : {}),
      },
      {
        onSuccess: () => {
          requestClose();
          toast({ message: t('feedback.sent') });
        },
      },
    );
  };

  return (
    <Modal open={!closing} onClose={requestClose}>
      <form onSubmit={send} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <ModalTitle>{t(media ? 'feedback.media.title' : 'feedback.title')}</ModalTitle>
          <p className="text-sm leading-relaxed text-muted">
            {t(media ? 'feedback.media.intro' : 'feedback.intro')}
          </p>
          {media && (
            <p className="text-sm font-semibold text-fg">
              {t('feedback.media.about', { title: media.title })}
            </p>
          )}
        </div>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1.5 font-label text-xs font-semibold tracking-label text-dim uppercase">
            {t('feedback.kind')}
          </legend>
          <div className="flex flex-wrap gap-2">
            {FEEDBACK_CATEGORIES.map((value) => (
              <Chip
                key={value}
                selected={category === value}
                onClick={() => setCategory(value)}
                disabled={submit.isPending}
              >
                {t(CATEGORY_KEYS[value])}
              </Chip>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="feedback-message"
            className="font-label text-xs font-semibold tracking-label text-dim uppercase"
          >
            {t('feedback.message')}
          </label>
          <textarea
            id="feedback-message"
            rows={5}
            maxLength={4000}
            value={message}
            placeholder={t(media ? 'feedback.media.placeholder' : 'feedback.placeholder')}
            onChange={(event) => setMessage(event.target.value)}
            disabled={submit.isPending}
            className="resize-none rounded-cover border border-white/12 bg-white/6 px-[18px] py-3.5 font-sans text-[15px] text-fg transition-colors outline-none placeholder:text-faint focus:border-pink/60"
          />
          <p className="flex items-baseline justify-between gap-3 text-xs text-faint">
            <span>{tooShort && trimmed.length > 0 ? t('feedback.minLength') : ''}</span>
            <span>{t('feedback.count', { used: trimmed.length, max: 4000 })}</span>
          </p>
        </div>

        <p className="text-xs leading-relaxed text-faint">
          {t(media ? 'feedback.media.context' : 'feedback.context')}
        </p>

        {submit.error && (
          <p role="alert" className="text-sm text-red-400">
            {t('feedback.error')}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={requestClose} disabled={submit.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={tooShort || submit.isPending}>
            {submit.isPending ? t('feedback.sending') : t('feedback.send')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
