import { createFileRoute } from '@tanstack/react-router';

/** The form itself lives in the `_auth` shell, which slides between both modes. */
export const Route = createFileRoute('/_auth/register')({
  head: ({ match }) => ({ meta: [{ title: match.context.i18n.t('meta.register') }] }),
  component: () => null,
});
