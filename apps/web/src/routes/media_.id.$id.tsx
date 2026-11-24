import { createFileRoute, redirect } from '@tanstack/react-router';

/** Stable permalink by canonical id; the media page swaps in the slug once it loads. */
export const Route = createFileRoute('/media_/id/$id')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/media/$slug', params: { slug: params.id }, replace: true });
  },
});
