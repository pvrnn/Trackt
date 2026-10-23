import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Scripts,
  useRouter,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import type { i18n as I18nInstance } from 'i18next';
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import appCss from '../styles.css?url';
import { buttonClassName } from '../components/ui/Button';
import { ToastProvider } from '../components/ui/Toast';

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  i18n: I18nInstance;
}>()({
  head: ({ match }) => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#0e0c10' },
      {
        name: 'description',
        content: match.context.i18n.t('meta.description'),
      },
      // Language-neutral: the per-route titles carry the translated surface name.
      { title: 'Trackt' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' },
    ],
  }),
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  const router = useRouter();
  // The shell sits outside every route component but inside RouterProvider, so
  // the instance comes from router context rather than a hook through a route.
  const i18n = router.options.context?.i18n;
  return (
    <html lang={i18n?.language ?? 'en'}>
      <head>
        <HeadContent />
      </head>
      <body>
        <MotionConfig reducedMotion="user">
          <LazyMotion features={domAnimation} strict>
            <ToastProvider>{children}</ToastProvider>
          </LazyMotion>
        </MotionConfig>
        <Scripts />
      </body>
    </html>
  );
}

/** TanStack's built-in not-found is English and unstyled; this one is neither. */
function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-ink px-6 text-center text-fg">
      <h1 className="font-heading text-[64px] leading-none uppercase">
        {t('shell.notFoundTitle')}
      </h1>
      <p className="max-w-[460px] text-[15px] text-muted">{t('shell.notFoundBody')}</p>
      <Link to="/home" className={buttonClassName()}>
        {t('shell.goHome')}
      </Link>
    </div>
  );
}
