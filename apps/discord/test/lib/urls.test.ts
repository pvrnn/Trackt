import { describe, expect, it } from 'vitest';
import { embeddableUrl } from '../../src/lib/urls.js';

describe('embeddableUrl', () => {
  it('resolves instance paths against APP_URL', () => {
    expect(embeddableUrl('/uploads/avatars/a.webp', 'https://trackt.example')).toBe(
      'https://trackt.example/uploads/avatars/a.webp',
    );
  });

  it('keeps absolute http(s) URLs', () => {
    expect(embeddableUrl('https://image.tmdb.org/t/p/w500/x.jpg', 'https://t.example')).toBe(
      'https://image.tmdb.org/t/p/w500/x.jpg',
    );
  });

  it('drops what Discord cannot fetch', () => {
    expect(embeddableUrl(null, 'https://t.example')).toBeNull();
    expect(embeddableUrl('data:image/png;base64,AAAA', 'https://t.example')).toBeNull();
  });
});
