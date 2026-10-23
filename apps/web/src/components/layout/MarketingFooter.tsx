import { Trans } from 'react-i18next';
import { Wordmark } from './Wordmark';

export function MarketingFooter() {
  return (
    <footer className="mx-auto flex w-full max-w-[1360px] flex-wrap items-center justify-between gap-5 px-6 pt-12 pb-16 sm:px-10">
      <Wordmark className="text-xl" />
      <p className="max-w-[560px] font-label text-xs text-dim">
        <Trans
          i18nKey="marketing.footer.credit"
          components={{
            tmdb: (
              <a
                href="https://www.themoviedb.org/"
                rel="noreferrer"
                className="text-fg hover:text-pink"
              />
            ),
            anilist: (
              <a href="https://anilist.co/" rel="noreferrer" className="text-fg hover:text-pink" />
            ),
            tvmaze: (
              <a
                href="https://www.tvmaze.com/"
                rel="noreferrer"
                className="text-fg hover:text-pink"
              />
            ),
          }}
        />
      </p>
    </footer>
  );
}
