import { createFileRoute } from '@tanstack/react-router';
import { MEDIA_KINDS } from '@trackt/shared';

export const Route = createFileRoute('/')({
  component: Home,
});

const FEATURES = [
  {
    title: 'Track everything',
    body: 'Per-episode and per-chapter progress for series, anime, manga, and webtoons. One-tap check-ins, rewatch counters, precise stats.',
  },
  {
    title: 'Your data, forever',
    body: 'Full export at any time in an open format, and a public API from day one. This project exists because TV Time users lost everything.',
  },
  {
    title: 'Self-host in one command',
    body: 'docker compose up and you have your own instance — your catalog, your community, your rules.',
  },
  {
    title: 'Community catalog',
    body: 'Webtoons and obscure titles the big databases skip? Add them yourself and share them across instances.',
  },
];

function Home() {
  return (
    <main className="page">
      <section className="hero">
        <img src="/icon.svg" alt="" width={72} height={72} />
        <h1>Trackt</h1>
        <p className="tagline">
          The community-owned tracker for {MEDIA_KINDS.join(', ')} — open source and impossible to
          take away from you.
        </p>
        <div className="actions">
          <a className="button" href="/docs" rel="noreferrer">
            API documentation
          </a>
          <a className="button secondary" href="https://github.com/pvrnn/Trackt" rel="noreferrer">
            GitHub
          </a>
        </div>
      </section>
      <section className="features">
        {FEATURES.map((feature) => (
          <article key={feature.title} className="card">
            <h2>{feature.title}</h2>
            <p>{feature.body}</p>
          </article>
        ))}
      </section>
      <footer className="footer">
        <p>
          Metadata from{' '}
          <a href="https://www.themoviedb.org/" rel="noreferrer">
            TMDB
          </a>
          ,{' '}
          <a href="https://anilist.co/" rel="noreferrer">
            AniList
          </a>{' '}
          and{' '}
          <a href="https://www.tvmaze.com/" rel="noreferrer">
            TVmaze
          </a>
          . This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
      </footer>
    </main>
  );
}
