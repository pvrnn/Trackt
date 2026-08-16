import {
  KIND_LABELS_SINGULAR,
  activityVerbLabel,
  relativeTime,
  useHomeSummary,
} from '@trackt/client';
import { IN_PROGRESS_LIMIT, type ActivityEntry, type UpNextEntry } from '@trackt/shared';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Cover } from '../../../src/components/Cover';
import { GlassCard } from '../../../src/components/GlassCard';
import { KindDot } from '../../../src/components/KindDot';
import {
  EmptyState,
  Loading,
  PageFrame,
  PageTitle,
  SectionTitle,
  useTabContentInset,
} from '../../../src/components/Page';
import { Touchable } from '../../../src/components/Touchable';
import { PrismText } from '../../../src/components/PrismText';
import { useAuthedScreen } from '../../../src/lib/session';
import { color, layout, radius, space, surface } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

/**
 * The home dashboard (`GET /me/home`), phase 2 — the read half of
 * `Home.dc.html` as the mobile spec reshapes it.
 *
 * Up next is a column of 72pt rows rather than web's three-across card grid: at
 * 362pt a card grid is one column anyway, and the row is the shape the swipe
 * check-in needs (`Mobile System.dc.html` §04). That swipe is phase 3 — until
 * the mutation exists a row does the one thing it can honestly do, which is
 * open the title. There is deliberately no check-in button that doesn't check
 * anything in.
 */
export default function HomeTab() {
  const { user, isPending: sessionPending } = useAuthedScreen();
  const { data, isPending, isError, refetch, isRefetching } = useHomeSummary();
  const bottomInset = useTabContentInset();
  const insets = useSafeAreaInsets();

  if (sessionPending || !user) {
    return (
      <PageFrame>
        <Loading />
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space.lg, paddingBottom: bottomInset },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={color.pink}
            colors={[color.pink]}
          />
        }
      >
        <PageTitle
          title="Up next"
          count={data ? `${data.upNext.length} waiting on you` : undefined}
        />

        {isPending ? (
          <Loading />
        ) : isError || !data ? (
          <EmptyState
            title="Couldn't load"
            body="The instance didn't answer. Pull down to try again."
          />
        ) : (
          <>
            {data.upNext.length === 0 ? (
              <EmptyState
                title="Nothing queued"
                body="Start something from Discover and its next episode shows up here."
              />
            ) : (
              <View style={styles.rows}>
                {data.upNext.map((entry) => (
                  <UpNextRow key={`${entry.id}:${entry.next}`} entry={entry} />
                ))}
              </View>
            )}

            {data.inProgress.length > 0 ? (
              <View style={styles.section}>
                <SectionTitle title="In progress" />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.shelf}
                >
                  {data.inProgress.map((entry) => (
                    <Touchable key={entry.id} href={`/media/${entry.slug}`}>
                      <Cover
                        kind={entry.kind}
                        title={entry.title}
                        coverUrl={entry.coverUrl}
                        width={96}
                        progress={entry.total ? entry.watched / entry.total : undefined}
                      />
                      <Text style={[type.bodySm, styles.shelfCaption]} numberOfLines={1}>
                        {entry.title}
                      </Text>
                      <Text style={[type.eyebrow, styles.dim]}>
                        {entry.total ? `${entry.watched} / ${entry.total}` : `${entry.watched}`}
                      </Text>
                    </Touchable>
                  ))}
                </ScrollView>
                {data.inProgress.length === IN_PROGRESS_LIMIT ? (
                  <Text style={[type.eyebrow, styles.shelfNote]}>
                    FIRST {IN_PROGRESS_LIMIT} · SEE HISTORY FOR THE REST
                  </Text>
                ) : null}
              </View>
            ) : null}

            <View style={styles.section}>
              <SectionTitle title="This year" />
              <View style={styles.stats}>
                <Stat value={data.stats.episodesThisYear} label="Episodes" />
                <Stat value={data.stats.chaptersThisYear} label="Chapters" />
                <Stat value={data.stats.completedThisYear} label="Completed" />
                <Stat value={data.stats.dayStreak} label="Day streak" />
              </View>
            </View>

            {data.activity.length > 0 ? (
              <View style={styles.section}>
                <SectionTitle title="Activity" />
                <GlassCard style={styles.activityCard}>
                  {data.activity.map((entry, index) => (
                    <ActivityRow
                      key={`${entry.slug}-${entry.at}-${index}`}
                      entry={entry}
                      first={index === 0}
                    />
                  ))}
                </GlassCard>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </PageFrame>
  );
}

/**
 * One 72pt up-next row: 40×56 thumb, title, and the part line the check-in will
 * target. The chevron is the affordance the spec calls for at rest — here it
 * means "opens", and from phase 3 it also hints the swipe.
 */
function UpNextRow({ entry }: { entry: UpNextEntry }) {
  const part = entry.partKind === 'episode' ? 'E' : 'CH';
  return (
    <Touchable href={`/media/${entry.slug}`} style={styles.row}>
      <Cover
        kind={entry.kind}
        title={entry.title}
        coverUrl={entry.coverUrl}
        width={40}
        showTitle={false}
      />
      <View style={styles.rowBody}>
        <Text style={[type.cardTitle, styles.rowTitle]} numberOfLines={1}>
          {entry.title}
        </Text>
        <View style={styles.metaRow}>
          <KindDot kind={entry.kind} />
          <Text style={[type.eyebrow, styles.dim]}>
            {KIND_LABELS_SINGULAR[entry.kind]} · {part}
            {entry.next}
            {entry.total ? ` OF ${entry.total}` : ''}
          </Text>
        </View>
      </View>
      <Text style={[type.section, styles.chevron]}>›</Text>
    </Touchable>
  );
}

function ActivityRow({ entry, first }: { entry: ActivityEntry; first: boolean }) {
  return (
    <Touchable
      href={`/media/${entry.slug}`}
      style={[styles.activityRow, !first && styles.activityDivider]}
    >
      <KindDot kind={entry.kind} />
      <Text style={[type.bodySm, styles.activityText]} numberOfLines={2}>
        {activityVerbLabel(entry)} {entry.title} <Text style={styles.dim}>{entry.detail}</Text>
      </Text>
      <Text style={[type.eyebrow, styles.dim]}>{relativeTime(entry.at)}</Text>
    </Touchable>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <GlassCard style={styles.stat}>
      <View style={styles.shrink}>
        <PrismText style={type.stat}>{String(value)}</PrismText>
      </View>
      <Text style={[type.eyebrow, styles.dim]}>{label.toUpperCase()}</Text>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: layout.gutter,
  },
  section: {
    marginTop: layout.sectionGap,
  },
  rows: {
    gap: space.sm,
  },
  row: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.cover,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: '#191520',
  },
  rowBody: {
    flex: 1,
    gap: space.xs,
  },
  rowTitle: {
    color: color.fg,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  chevron: {
    color: color.faint,
  },
  shelf: {
    gap: space.md,
    paddingRight: layout.gutter,
  },
  shelfCaption: {
    color: color.fg,
    width: 96,
    marginTop: space.sm,
  },
  shelfNote: {
    color: color.faint,
    marginTop: space.md,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
  },
  stat: {
    flexGrow: 1,
    flexBasis: '45%',
    padding: space.lg,
    gap: space.xs,
  },
  shrink: {
    alignSelf: 'flex-start',
  },
  activityCard: {
    paddingHorizontal: space.lg,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    minHeight: layout.touchTarget,
  },
  activityDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: surface.divider,
  },
  activityText: {
    flex: 1,
    color: color.fg,
  },
  dim: {
    color: color.dim,
  },
});
