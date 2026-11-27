import { formatRarity, TIER_MATERIAL, trophyPercent, useTrophyCabinet } from '@trackt/client';
import { TrophyIdSchema, type TrophyEntry } from '@trackt/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../../src/components/Avatar';
import { GlassCard } from '../../../src/components/GlassCard';
import { KindDot } from '../../../src/components/KindDot';
import { PageScroll, ScreenState } from '../../../src/components/Page';
import { PrismButton } from '../../../src/components/PrismButton';
import { Touchable } from '../../../src/components/Touchable';
import { useTrophyCopy } from '../../../src/components/trophies/copy';
import { Medal } from '../../../src/components/trophies/Medal';
import { TierChip } from '../../../src/components/trophies/TierChip';
import { useInstance } from '../../../src/lib/instance-provider';
import { color, radius, space, surface } from '../../../src/theme/tokens';
import { displayLine, font, type } from '../../../src/theme/typography';
import { useLabels } from '../../../src/lib/labels';

/** One trophy as a medal you can spin (`Mobile Trophies.dc.html` — TROPHY · DETAIL). */
export default function TrophyScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const parsed = TrophyIdSchema.safeParse(id);
  const { data, isPending } = useTrophyCabinet();
  const trophy = parsed.success ? data?.trophies.find((x) => x.id === parsed.data) : undefined;

  if (!data || !trophy) {
    return (
      <ScreenState
        isPending={isPending}
        title={t('trophies.title')}
        body={t('trophies.loadError')}
      />
    );
  }
  return <Detail trophy={trophy} owner={data.owner.username} />;
}

function Detail({ trophy, owner }: { trophy: TrophyEntry; owner: string }) {
  const { t } = useTranslation();
  const copy = useTrophyCopy();
  const labels = useLabels();
  const { origin } = useInstance();
  const material = TIER_MATERIAL[trophy.tier];
  const locked = trophy.unlockedAt === null;
  const pct = trophyPercent(trophy);
  const stats: [string, string][] = locked
    ? [
        [`${pct}%`, t('trophies.stat.done')],
        [String(trophy.points), t('trophies.stat.points')],
        [formatRarity(trophy.rarity), t('trophies.stat.haveIt')],
      ]
    : [
        [formatRarity(trophy.rarity), t('trophies.stat.haveIt')],
        [String(trophy.points), t('trophies.stat.points')],
        [copy.date(trophy.unlockedAt as string), t('trophies.stat.unlocked')],
      ];

  const share = () => {
    void Share.share({
      message: `${t('trophies.shareText', { name: copy.name(trophy) })} ${origin ?? ''}/users/${encodeURIComponent(owner)}`,
    });
  };

  return (
    <PageScroll title={copy.name(trophy)}>
      {trophy.serial ? (
        <Text style={styles.serial}>
          {t('trophies.serial', {
            serial: copy.number(trophy.serial),
            holders: copy.number(trophy.holders),
          })}
        </Text>
      ) : null}
      <Medal trophy={trophy} owner={owner} />

      <View style={styles.head}>
        <Text style={[type.title, styles.name]}>{copy.name(trophy).toUpperCase()}</Text>
        <View style={styles.tierLine}>
          <TierChip tier={trophy.tier} width={12} />
          <Text style={[styles.lineText, { color: material.fg }]}>
            {t('trophies.tierLine', { tier: copy.tier(trophy.tier) })}
          </Text>
          <Text style={styles.lineDim}>·</Text>
          <Text style={styles.lineText}>
            {trophy.points} {t('trophies.ptsUnit')}
          </Text>
          <Text style={styles.lineDim}>·</Text>
          <Text style={[styles.lineText, { color: locked ? color.dim : color.kindGame }]}>
            {locked
              ? t('trophies.locked')
              : t('trophies.unlockedOn', { date: copy.date(trophy.unlockedAt as string) })}
          </Text>
        </View>
        <Text style={styles.desc}>{copy.description(trophy)}</Text>
      </View>

      {locked ? (
        <View style={styles.progress}>
          <View style={styles.progressHead}>
            <Text style={styles.lab}>{t('trophies.progress')}</Text>
            <Text style={styles.lineText}>{copy.progress(trophy)}</Text>
          </View>
          <View style={styles.track}>
            <LinearGradient
              colors={
                (material.chip.length > 1
                  ? [...material.chip]
                  : [material.chip[0], material.chip[0]]) as [string, string]
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.fill, { width: `${pct}%` }]}
            />
          </View>
        </View>
      ) : null}

      <GlassCard style={styles.stats}>
        {stats.map(([value, key], i) => (
          <View key={key} style={[styles.stat, i > 0 ? styles.ruled : null]}>
            <Text style={styles.statValue}>{value}</Text>
            <Text style={styles.statKey}>{key}</Text>
          </View>
        ))}
      </GlassCard>

      {trophy.evidence.length > 0 ? (
        <>
          <Text style={[type.section, styles.h2]}>{t('trophies.howYouGotIt').toUpperCase()}</Text>
          <GlassCard>
            {trophy.evidence.map((e, i) => (
              <Touchable
                key={e.mediaId}
                href={`/media/${e.slug}`}
                style={[styles.evidence, i > 0 ? styles.evidenceRule : null]}
              >
                <KindDot kind={e.kind} size={8} />
                <Text style={styles.evidenceKind}>{labels.kindSingular(e.kind)}</Text>
                <Text style={styles.evidenceTitle} numberOfLines={1}>
                  {e.title}
                </Text>
                <Text style={styles.evidenceDate}>{copy.date(e.at)}</Text>
              </Touchable>
            ))}
          </GlassCard>
        </>
      ) : null}

      <View style={styles.friends}>
        {trophy.friends.sample.length > 0 ? (
          <View style={styles.faces}>
            {trophy.friends.sample.map((f, i) => (
              <View key={f.username} style={i > 0 ? styles.overlap : null}>
                <Avatar name={f.name} image={f.image} size={28} />
              </View>
            ))}
          </View>
        ) : null}
        <Text style={styles.friendsText}>{copy.friendsLine(trophy)}</Text>
      </View>

      {!locked ? (
        <PrismButton label={t('trophies.share')} variant="secondary" onPress={share} />
      ) : null}
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  serial: {
    alignSelf: 'flex-end',
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: 1,
    color: color.muted,
  },
  head: { alignItems: 'center', gap: space.sm, marginTop: space.lg },
  name: { color: color.fg, textAlign: 'center' },
  tierLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  lineText: { fontFamily: font.label, fontSize: 11, letterSpacing: 1.1, color: '#cfc9d8' },
  lineDim: { fontFamily: font.label, fontSize: 11, color: color.dim },
  desc: {
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 21,
    color: color.muted,
    textAlign: 'center',
    maxWidth: 300,
  },
  progress: { gap: space.sm, marginTop: space.lg },
  progressHead: { flexDirection: 'row', justifyContent: 'space-between' },
  lab: { fontFamily: font.label, fontSize: 10, letterSpacing: 1, color: color.dim },
  track: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill },
  stats: { flexDirection: 'row', marginTop: space.lg },
  stat: { flex: 1, alignItems: 'center', gap: 5, paddingVertical: space.md },
  ruled: { borderLeftWidth: 1, borderLeftColor: surface.divider },
  statValue: {
    fontFamily: font.display,
    fontSize: 20,
    lineHeight: displayLine(20),
    color: color.fg,
  },
  statKey: { fontFamily: font.label, fontSize: 8, letterSpacing: 0.8, color: color.dim },
  h2: { color: color.fg, marginTop: space.xl, marginBottom: space.md },
  evidence: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 48,
    paddingHorizontal: space.lg,
  },
  evidenceRule: { borderTopWidth: 1, borderTopColor: surface.divider },
  evidenceKind: {
    width: 62,
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: 0.8,
    color: color.muted,
  },
  evidenceTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: font.bodySemibold,
    fontSize: 14,
    color: color.fg,
  },
  evidenceDate: { fontFamily: font.label, fontSize: 10, letterSpacing: 0.6, color: color.dim },
  friends: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: space.lg },
  faces: { flexDirection: 'row' },
  overlap: { marginLeft: -8 },
  friendsText: { flex: 1, fontFamily: font.body, fontSize: 13, color: color.muted },
});
