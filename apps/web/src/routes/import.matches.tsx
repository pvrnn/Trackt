import { createFileRoute } from '@tanstack/react-router';
import { ImportMatches } from '../components/imports/ImportMatches';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { useAuthedPage } from '../lib/auth-client';

/** The titles an import kept aside for the viewer to settle (docs/design/Import Matches.dc.html). */
export const Route = createFileRoute('/import/matches')({
  head: ({ match }) => ({ meta: [{ title: match.context.i18n.t('meta.importMatches') }] }),
  component: ImportMatchesPage,
});

function ImportMatchesPage() {
  const { isPending, navUser } = useAuthedPage();
  if (isPending || !navUser) return <div className="min-h-screen bg-ink" />;
  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        <AppNav user={navUser} />
        <ImportMatches />
      </div>
    </div>
  );
}
