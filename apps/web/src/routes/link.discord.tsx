import { createFileRoute, Link } from '@tanstack/react-router';
import { useDiscordLinkCode, useLinkDiscord } from '@trackt/client';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { Button, buttonClassName } from '../components/ui/Button';
import { GlassCard } from '../components/ui/GlassCard';
import { useAuthedPage } from '../lib/auth-client';

/** Where the bot's `/link` button lands: confirm which Discord account joins this Trackt account. */
export const Route = createFileRoute('/link/discord')({
  head: () => ({ meta: [{ title: 'Link Discord — Trackt' }] }),
  validateSearch: (search: Record<string, unknown>): { code?: string } => ({
    code: typeof search.code === 'string' ? search.code : undefined,
  }),
  component: LinkDiscordPage,
});

function LinkDiscordPage() {
  const { isPending, navUser } = useAuthedPage();
  const { code } = Route.useSearch();
  const { data: preview, isPending: previewPending, isError } = useDiscordLinkCode(code);
  const link = useLinkDiscord();

  if (isPending || !navUser) return <div className="min-h-screen bg-ink" />;

  let body;
  if (link.data?.linked) {
    body = (
      <>
        <p className="text-[15px] text-muted">
          Discord account{' '}
          <span className="font-semibold text-fg">@{link.data.linked.discordUsername}</span> is now
          linked. Try <code className="text-pink">/profile</code> in Discord.
        </p>
        <Link to="/profile" className={buttonClassName({ variant: 'secondary' })}>
          BACK TO PROFILE
        </Link>
      </>
    );
  } else if (!code || (!previewPending && !preview)) {
    body = (
      <p className="text-[15px] text-muted">
        {isError
          ? 'Couldn’t check this link — is the instance API reachable?'
          : 'This link has expired or was already used. Run /link in Discord again for a fresh one.'}
      </p>
    );
  } else if (!preview) {
    body = <div className="h-20" aria-busy />;
  } else {
    body = (
      <>
        <p className="text-[15px] text-muted">
          Link Discord account{' '}
          <span className="font-semibold text-fg">@{preview.discordUsername}</span> to your Trackt
          account <span className="font-semibold text-fg">@{navUser.username}</span>? The bot will
          show your profile when asked, and mark what you watch together in watch parties.
        </p>
        {link.isError && (
          <p role="alert" className="text-sm text-red-400">
            Linking failed — the link may have just expired. Run /link in Discord again.
          </p>
        )}
        <div className="flex gap-3">
          <Button onClick={() => link.mutate(code)} disabled={link.isPending}>
            {link.isPending ? 'LINKING…' : 'LINK ACCOUNTS'}
          </Button>
          <Link to="/profile" className={buttonClassName({ variant: 'ghost' })}>
            CANCEL
          </Link>
        </div>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        <AppNav user={navUser} />
        <main className="mx-auto flex max-w-[640px] flex-col gap-6 px-10 pt-16 pb-20">
          <h1 className="font-heading text-[44px] leading-none uppercase">Link Discord</h1>
          <GlassCard className="flex flex-col gap-5 rounded-card-sm px-6 py-6">{body}</GlassCard>
        </main>
      </div>
    </div>
  );
}
