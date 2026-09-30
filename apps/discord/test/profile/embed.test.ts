import type { PublicProfile } from '@trackt/shared';
import { describe, expect, it } from 'vitest';
import { profileEmbed } from '../../src/profile/embed.js';

const profile: PublicProfile = {
  userId: '00000000-0000-4000-8000-000000000001',
  user: {
    name: 'Ada',
    username: 'ada',
    bio: 'Watches everything twice.',
    image: '/uploads/avatars/ada.webp',
    socialLinks: {},
    joinedAt: '2025-03-01T00:00:00.000Z',
  },
  stats: {
    episodesThisYear: 120,
    chaptersThisYear: 30,
    completed: 42,
    titlesTracked: 80,
    meanRating: 7.25,
    dayStreak: 3,
  },
  favorites: [
    {
      id: '00000000-0000-4000-8000-00000000000b',
      slug: 'b',
      kind: 'anime',
      title: 'Second',
      coverUrl: null,
      rank: 2,
    },
    {
      id: '00000000-0000-4000-8000-00000000000a',
      slug: 'a',
      kind: 'movie',
      title: 'First [cut]',
      coverUrl: null,
      rank: 1,
    },
  ],
  activity: [
    {
      verb: 'checked_in',
      title: 'Frieren',
      slug: 'frieren-2023',
      kind: 'anime',
      detail: 'E5',
      at: '2026-09-30T10:00:00.000Z',
    },
    {
      verb: 'rated',
      title: 'Dune',
      slug: 'dune-2021',
      kind: 'movie',
      detail: '★ 9',
      at: '2026-09-29T10:00:00.000Z',
    },
  ],
  friendState: 'none',
  friendCount: 2,
};

describe('profileEmbed', () => {
  const json = profileEmbed(profile, 'https://trackt.example').toJSON();

  it('credits the user and links their Trackt profile', () => {
    expect(json.author).toEqual({
      name: 'Ada (@ada)',
      url: 'https://trackt.example/users/ada',
      icon_url: 'https://trackt.example/uploads/avatars/ada.webp',
    });
    expect(json.description).toBe('Watches everything twice.');
  });

  it('shows the stats', () => {
    const fields = Object.fromEntries((json.fields ?? []).map((f) => [f.name, f.value]));
    expect(fields).toMatchObject({
      Completed: '42',
      Tracked: '80',
      'Mean rating': '7.3',
      'Episodes this year': '120',
      'Day streak': '3',
    });
  });

  it('lists favourites by rank, with links that survive brackets in titles', () => {
    const favourites = json.fields?.find((f) => f.name === 'Favourites')?.value;
    expect(favourites).toBe(
      '[First cut](https://trackt.example/media/a) · [Second](https://trackt.example/media/b)',
    );
  });

  it('renders activity with Discord timestamps', () => {
    const recent = json.fields?.find((f) => f.name === 'Recent')?.value;
    expect(recent?.split('\n')).toEqual([
      'Watched [Frieren](https://trackt.example/media/frieren-2023) **E5** · <t:1790762400:R>',
      'Rated [Dune](https://trackt.example/media/dune-2021) **★ 9** · <t:1790676000:R>',
    ]);
  });

  it('leaves out empty sections', () => {
    const bare = profileEmbed(
      {
        ...profile,
        favorites: [],
        activity: [],
        user: { ...profile.user, bio: null, image: null },
      },
      'https://trackt.example',
    ).toJSON();
    expect(bare.description).toBeUndefined();
    expect(bare.author?.icon_url).toBeUndefined();
    expect(bare.fields?.map((f) => f.name)).not.toContain('Favourites');
    expect(bare.fields?.map((f) => f.name)).not.toContain('Recent');
  });
});
