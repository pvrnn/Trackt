import { nextUpTrophies, recentTrophies, useTrophyCabinet } from '@trackt/client';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { EmptyState, PageScroll, PageTitle, QueryState } from '../../../src/components/Page';
import { Touchable } from '../../../src/components/Touchable';
import { Shelf } from '../../../src/components/trophies/Shelf';
import { TrophySummary } from '../../../src/components/trophies/Summary';
import { color, space } from '../../../src/theme/tokens';
import { font, type } from '../../../src/theme/typography';

const RECENT = 4;
const NEXT = 3;

/** The cabinet (`Mobile Trophies.dc.html` — TROPHIES · CABINET), pushed from Profile. */
export default function TrophiesScreen() {
  const { t } = useTranslation();
  const { data, dataUpdatedAt, isPending, isError } = useTrophyCabinet();

  return (
    <PageScroll title={t('trophies.title')}>
      <View style={styles.titleRow}>
        <PageTitle
          title={t('trophies.title')}
          count={
            data
              ? t('trophies.unlockedOfShort', { unlocked: data.unlocked, total: data.total })
              : undefined
          }
        />
        <Touchable href="/trophies/leaderboard" style={styles.link}>
          <Text style={styles.linkText}>{t('trophies.leaderboard.open')}</Text>
        </Touchable>
      </View>
      <QueryState
        query={{ data, isPending, isError, dataUpdatedAt }}
        error={{ title: t('trophies.title'), body: t('trophies.loadError') }}
      >
        {(cabinet) => {
          const recent = recentTrophies(cabinet, RECENT);
          const next = nextUpTrophies(cabinet, NEXT);
          return (
            <View style={styles.body}>
              <TrophySummary cabinet={cabinet} />

              <View style={styles.section}>
                <Text style={[type.section, styles.h2]}>
                  {t('trophies.recent.title').toUpperCase()}
                </Text>
                {recent.length > 0 ? (
                  <Text style={styles.hint}>{t('trophies.recent.hintTouch')}</Text>
                ) : null}
              </View>
              {recent.length > 0 ? (
                <Shelf trophies={recent} columns={RECENT} />
              ) : (
                <EmptyState title={t('trophies.recent.title')} body={t('trophies.recent.empty')} />
              )}

              <View style={styles.section}>
                <Text style={[type.section, styles.h2]}>
                  {t('trophies.next.title').toUpperCase()}
                </Text>
                {next.length > 0 ? (
                  <Text style={styles.hint}>{t('trophies.next.hintTouch')}</Text>
                ) : null}
              </View>
              {next.length > 0 ? (
                <Shelf trophies={next} columns={NEXT} offset={RECENT} />
              ) : (
                <Text style={[type.bodySm, { color: color.muted }]}>
                  {t('trophies.next.empty')}
                </Text>
              )}
            </View>
          );
        }}
      </QueryState>
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  titleRow: { gap: space.xs },
  link: { alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center' },
  linkText: { fontFamily: font.label, fontSize: 11, letterSpacing: 0.88, color: color.pinkInk },
  body: { gap: space.lg },
  section: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  h2: { color: color.fg },
  hint: { fontFamily: font.label, fontSize: 10, letterSpacing: 1, color: color.dim },
});
