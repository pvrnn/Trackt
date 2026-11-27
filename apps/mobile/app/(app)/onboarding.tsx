import {
  useDebounced,
  useImportSources,
  useSendFriendRequest,
  useStartImport,
  useUserSearch,
  type ImportSourceStatus,
} from '@trackt/client';
import type { UserSearchResult } from '@trackt/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ScrollViewInstance } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuraBackground } from '../../src/components/AuraBackground';
import { StepHeader } from '../../src/components/HeaderControls';
import { Avatar } from '../../src/components/Avatar';
import { BrandTile } from '../../src/components/BrandTile';
import { Icon, type IconName } from '../../src/components/Icon';
import { AnimatedPressable, ripple, usePressMotion } from '../../src/components/Press';
import { PrismButton } from '../../src/components/PrismButton';
import { PrismText } from '../../src/components/PrismText';
import { commitHaptic, errorHaptic } from '../../src/lib/haptics';
import { useInstance } from '../../src/lib/instance-provider';
import { useLabels } from '../../src/lib/labels';
import { duration } from '../../src/lib/motion';
import { useAuthedScreen } from '../../src/lib/session';
import {
  PRISM,
  color,
  control,
  layout,
  radius,
  space,
  stroke,
  surface,
  text,
} from '../../src/theme/tokens';
import { displayLine, font, type } from '../../src/theme/typography';

/**
 * First run, after sign-up (`Mobile App.dc.html` — "ONBOARDING"): import,
 * friends, start, as full pages rather than the web's dialog. Like web, it is
 * reached only from the register screen; leaving it any way lands on Home.
 *
 * Profile imports are queued when step 1 is continued — the design's "nothing
 * is imported until you continue". File sources need a document picker this
 * build does not ship, so their rows point at the web app instead.
 */

const STEPS = ['import', 'friends', 'done'] as const;
type Step = (typeof STEPS)[number];

/** The design's order; a source the instance adds later goes last. */
const SOURCE_ORDER = ['letterboxd', 'mal', 'anilist', 'tvtime', 'steam', 'trakt'];

/**
 * Sized to the longest label a row action wears in either language (§08 "one
 * width per list"): a `size="row"` PrismButton carries 24pt side padding and a
 * 16pt glyph, so the mockup's 124 clips "✓ CONNECTED".
 */
const ROW_ACTION_WIDTH = 164;

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { user } = useAuthedScreen();
  const scroll = useRef<ScrollViewInstance>(null);

  const [step, setStep] = useState<Step>('import');
  const idx = STEPS.indexOf(step);

  const sourcesQuery = useImportSources();
  const sources = (sourcesQuery.data?.sources ?? [])
    .filter((source) => source.available)
    .sort((a, b) => order(a.id) - order(b.id));
  /** Profile per connected source; a key present means connected. */
  const [connected, setConnected] = useState<Record<string, string>>({});
  const [started, setStarted] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const startImport = useStartImport();

  const [selected, setSelected] = useState<Map<string, UserSearchResult>>(new Map());
  const [requested, setRequested] = useState<Map<string, UserSearchResult>>(new Map());
  const [sendError, setSendError] = useState(false);
  const [sending, setSending] = useState(false);
  const sendRequest = useSendFriendRequest();

  const connectedSources = sources.filter((source) => connected[source.id] !== undefined);
  const pendingSources = connectedSources.filter((source) => !started.has(source.id));
  const queuedSources = sources.filter((source) => started.has(source.id));

  const go = (next: Step) => {
    setSendError(false);
    setStep(next);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const back = () => {
    if (idx > 0) go(STEPS[idx - 1]!);
  };
  const leave = () => router.replace('/home');

  // Android's back walks the steps; on the first one it does what it always does.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (idx === 0) return false;
      go(STEPS[idx - 1]!);
      return true;
    });
    return () => sub.remove();
  });

  const queueImports = async () => {
    setStarting(true);
    const batch = pendingSources;
    const results = await Promise.allSettled(
      batch.map((source) =>
        startImport.mutateAsync({ source: source.id, profile: connected[source.id]! }),
      ),
    );
    setStarting(false);
    const nextStarted = new Set(started);
    const nextFailed = new Set<string>();
    results.forEach((result, i) => {
      const id = batch[i]!.id;
      if (result.status === 'fulfilled') nextStarted.add(id);
      else nextFailed.add(id);
    });
    setStarted(nextStarted);
    setFailed(nextFailed);
    if (nextFailed.size > 0) {
      errorHaptic();
      return;
    }
    commitHaptic();
    go('friends');
  };

  const sendSelected = async () => {
    setSending(true);
    setSendError(false);
    const people = [...selected.values()];
    const results = await Promise.allSettled(
      people.map((person) => sendRequest.mutateAsync(person.username)),
    );
    setSending(false);
    const stillSelected = new Map<string, UserSearchResult>();
    const sent = new Map(requested);
    results.forEach((result, i) => {
      const person = people[i]!;
      (result.status === 'rejected' ? stillSelected : sent).set(person.id, person);
    });
    setRequested(sent);
    setSelected(stillSelected);
    if (stillSelected.size > 0) {
      setSendError(true);
      errorHaptic();
      return;
    }
    commitHaptic();
    go('done');
  };

  const busy = starting || sending;
  const ready =
    step === 'import'
      ? connectedSources.length > 0 || queuedSources.length > 0
      : selected.size > 0 || requested.size > 0;
  const next = () => {
    if (!ready || busy) return;
    if (step === 'import' && pendingSources.length > 0) void queueImports();
    else if (step === 'friends' && selected.size > 0) void sendSelected();
    else go(STEPS[idx + 1]!);
  };
  const nextLabel = sending
    ? t('onboarding.friends.sending')
    : step === 'friends' && selected.size > 0
      ? t('onboarding.friends.send', { count: selected.size })
      : t('onboarding.continue');

  return (
    <View style={styles.root}>
      <AuraBackground />
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <StepHeader
          label={t('onboarding.stepOf', { n: idx + 1, total: STEPS.length })}
          emphasis={t(`onboarding.stepNames.${step}`)}
          onClose={step !== 'done' ? () => leave() : undefined}
          closeLabel={t('onboarding.skipAllAria')}
          progress={{ step: idx + 1, total: STEPS.length }}
          style={[styles.header, { paddingTop: insets.top + space.md }]}
        />

        <ScrollView
          ref={scroll}
          style={styles.root}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View
            key={step}
            entering={FadeIn.duration(duration.commit)}
            style={styles.stack}
          >
            <View style={styles.intro}>
              <Text style={styles.title} accessibilityRole="header">
                {t(`onboarding.${step}.title`).toUpperCase()}
              </Text>
              <Text style={styles.lede}>{t(`onboarding.${step}.lede`)}</Text>
            </View>

            {step === 'import' ? (
              <ImportStep
                sources={sources}
                loading={sourcesQuery.isPending}
                loadFailed={sourcesQuery.isError}
                connected={connected}
                started={started}
                failed={failed}
                onConnect={(id, profile) => {
                  setConnected((current) => ({ ...current, [id]: profile }));
                  setFailed((current) => without(current, id));
                }}
                onDisconnect={(id) => {
                  setConnected(({ [id]: _dropped, ...rest }) => rest);
                  setFailed((current) => without(current, id));
                }}
                pendingCount={pendingSources.length}
                queuedCount={queuedSources.length}
              />
            ) : step === 'friends' ? (
              <FriendsStep
                username={user?.username ?? ''}
                selected={selected}
                requested={requested}
                onToggle={(person) =>
                  setSelected((current) => {
                    const nextSet = new Map(current);
                    if (nextSet.has(person.id)) nextSet.delete(person.id);
                    else nextSet.set(person.id, person);
                    return nextSet;
                  })
                }
                error={sendError}
              />
            ) : (
              <DoneStep names={queuedSources.map((source) => source.label)} sent={requested.size} />
            )}
          </Animated.View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
          {idx > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.back')}
              onPress={back}
              android_ripple={ripple(true)}
              style={({ pressed }) => [styles.backDisc, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Icon name="chevron-left" color={color.fg} size={18} />
            </Pressable>
          ) : null}
          {step !== 'done' ? (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={() => go(STEPS[idx + 1]!)}
                disabled={busy}
                style={({ pressed }) => [styles.skip, { opacity: pressed || busy ? 0.6 : 1 }]}
              >
                <Text style={styles.skipLabel} numberOfLines={1}>
                  {t('onboarding.skip')}
                </Text>
              </Pressable>
              <FooterPrimary label={nextLabel} onPress={next} live={ready} busy={busy} flex={1.3} />
            </>
          ) : (
            <FooterPrimary
              label={t('onboarding.done.home')}
              onPress={() => leave()}
              live
              busy={false}
              flex={1}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function order(id: string): number {
  const at = SOURCE_ORDER.indexOf(id);
  return at === -1 ? SOURCE_ORDER.length : at;
}

function without(set: Set<string>, id: string): Set<string> {
  if (!set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
}

/** The gradient pill, grey until the step has something to submit (§08 "one primary"). */
function FooterPrimary({
  label,
  onPress,
  live,
  busy,
  flex,
}: {
  label: string;
  onPress: () => void;
  live: boolean;
  busy: boolean;
  flex: number;
}) {
  const press = usePressMotion();
  const inert = !live || busy;
  const content = (
    <>
      {busy ? <ActivityIndicator size="small" color={color.onPrism} /> : null}
      <Text style={[styles.footerLabel, live ? text.onPrism : text.dim]} numberOfLines={1}>
        {label}
      </Text>
      {busy ? null : (
        <Icon name="chevron-right" color={live ? color.onPrism : color.dim} size={14} />
      )}
    </>
  );
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy }}
      disabled={inert}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[styles.primary, { flex }, inert ? null : press.animatedStyle]}
    >
      {live ? (
        <LinearGradient
          colors={[...PRISM]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.primaryFill}
        >
          {content}
        </LinearGradient>
      ) : (
        <View style={[styles.primaryFill, styles.primaryIdle]}>{content}</View>
      )}
    </AnimatedPressable>
  );
}

type ActionTone = 'idle' | 'on' | 'inert' | 'quiet';

/**
 * A row's one action at one shared width in every row and state, so the list's
 * right edge is straight (§08). `quiet` is a settled state with nothing to do:
 * a label, not a button.
 */
function RowAction({
  label,
  tone,
  icon,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  accessibilityLabel?: string;
  tone: ActionTone;
  icon?: IconName;
  onPress?: () => void;
}) {
  if (tone === 'quiet') {
    return (
      <View style={styles.rowQuiet}>
        <Text style={[type.button, text.dim]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    );
  }
  return (
    <PrismButton
      label={label}
      {...(icon ? { icon } : {})}
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      size="row"
      variant={tone === 'on' ? 'state' : 'secondary'}
      disabled={!onPress || tone === 'inert'}
      onPress={onPress ?? noop}
      style={styles.rowAction}
    />
  );
}

function noop() {}

function ImportStep({
  sources,
  loading,
  loadFailed,
  connected,
  started,
  failed,
  onConnect,
  onDisconnect,
  pendingCount,
  queuedCount,
}: {
  sources: ImportSourceStatus[];
  loading: boolean;
  loadFailed: boolean;
  connected: Record<string, string>;
  started: Set<string>;
  failed: Set<string>;
  onConnect: (id: string, profile: string) => void;
  onDisconnect: (id: string) => void;
  pendingCount: number;
  queuedCount: number;
}) {
  const { t } = useTranslation();
  /** The one row whose username field is open. */
  const [editing, setEditing] = useState<string | null>(null);

  if (loading) return <ActivityIndicator color={color.pink} style={styles.loading} />;
  if (loadFailed || sources.length === 0) {
    return (
      <Text style={styles.emptyBox}>
        {loadFailed ? t('onboarding.import.loadFailed') : t('onboarding.import.none')}
      </Text>
    );
  }

  const foot =
    pendingCount > 0
      ? t('onboarding.import.foot', { count: pendingCount })
      : queuedCount > 0
        ? t('onboarding.import.footStarted', { count: queuedCount })
        : t('onboarding.import.footIdle');

  return (
    <>
      <View style={styles.rows}>
        {sources.map((source) => (
          <SourceRow
            key={source.id}
            source={source}
            profile={connected[source.id]}
            started={started.has(source.id)}
            failed={failed.has(source.id)}
            editing={editing === source.id}
            onEdit={(open) => setEditing(open ? source.id : null)}
            onConnect={(profile) => {
              onConnect(source.id, profile);
              setEditing(null);
            }}
            onDisconnect={() => onDisconnect(source.id)}
          />
        ))}
      </View>
      <Text style={[styles.note]}>{foot}</Text>
    </>
  );
}

function SourceRow({
  source,
  profile,
  started,
  failed,
  editing,
  onEdit,
  onConnect,
  onDisconnect,
}: {
  source: ImportSourceStatus;
  profile: string | undefined;
  started: boolean;
  failed: boolean;
  editing: boolean;
  onEdit: (open: boolean) => void;
  onConnect: (profile: string) => void;
  onDisconnect: () => void;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const [draft, setDraft] = useState('');
  const isFile = source.access === 'file';
  const done = profile !== undefined;
  const steam = source.id === 'steam';

  const kinds = source.kinds.map((kind) => labels.kind(kind)).join(', ');
  const idle = isFile
    ? t('onboarding.import.fileIdle')
    : steam
      ? t('onboarding.import.steamIdle')
      : t('onboarding.import.profileIdle', { name: source.label });
  const note = failed
    ? t('onboarding.import.startFailed')
    : started
      ? `${t('onboarding.import.queued')} · ${profile ?? ''}`
      : done
        ? profile
        : sentenceCase(kinds ? `${kinds} · ${idle}` : idle);

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onConnect(trimmed);
    setDraft('');
  };

  return (
    <View style={[styles.sourceRow, done && !failed ? styles.sourceRowOn : null]}>
      <View style={styles.sourceLine}>
        <BrandTile source={source.id} label={source.label} />
        <View style={styles.sourceText}>
          <Text style={[type.cardTitle, text.fg]} numberOfLines={1}>
            {source.label}
          </Text>
          <Text
            style={[styles.sourceNote, failed ? text.pink : done ? text.pinkInk : text.muted]}
            numberOfLines={1}
            {...(failed ? { accessibilityRole: 'alert' as const } : {})}
          >
            {note}
          </Text>
        </View>
        {isFile ? (
          <RowAction
            label={t('onboarding.import.onWeb')}
            tone="inert"
            accessibilityLabel={t('onboarding.import.onWebAria', { name: source.label })}
          />
        ) : started ? (
          <RowAction label={t('onboarding.import.importing')} tone="on" icon="check" />
        ) : done ? (
          <RowAction
            label={t('onboarding.import.connected')}
            tone="on"
            icon="check"
            accessibilityLabel={t('onboarding.import.disconnectAria', { name: source.label })}
            onPress={onDisconnect}
          />
        ) : editing ? (
          <RowAction
            label={t('onboarding.import.cancel')}
            tone="idle"
            onPress={() => onEdit(false)}
          />
        ) : (
          <RowAction
            label={t('onboarding.import.connect')}
            tone="idle"
            accessibilityLabel={t('onboarding.import.connectAria', { name: source.label })}
            onPress={() => onEdit(true)}
          />
        )}
      </View>

      {editing && !done ? (
        <View style={styles.sourceLine}>
          <TextInput
            autoFocus
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submit}
            returnKeyType="done"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={
              steam
                ? t('onboarding.import.steamPlaceholder')
                : t('onboarding.import.placeholder', { name: source.label })
            }
            placeholder={
              steam
                ? t('onboarding.import.steamPlaceholder')
                : t('onboarding.import.placeholder', { name: source.label })
            }
            placeholderTextColor={color.faint}
            style={[type.input, styles.input]}
          />
          <RowAction
            label={t('onboarding.import.add')}
            tone={draft.trim() ? 'idle' : 'inert'}
            {...(draft.trim() ? { onPress: submit } : {})}
          />
        </View>
      ) : null}
    </View>
  );
}

/** "ANIME, MANGA · your AniList username" → "Anime, manga · your AniList username". */
function sentenceCase(value: string): string {
  const [head, ...rest] = value.split(' · ');
  const lowered = (head ?? '').toLocaleLowerCase();
  const first = lowered.charAt(0).toLocaleUpperCase() + lowered.slice(1);
  return [first, ...rest].join(' · ');
}

function FriendsStep({
  username,
  selected,
  requested,
  onToggle,
  error,
}: {
  username: string;
  selected: Map<string, UserSearchResult>;
  requested: Map<string, UserSearchResult>;
  onToggle: (person: UserSearchResult) => void;
  error: boolean;
}) {
  const { t } = useTranslation();
  const { origin } = useInstance();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query).trim();
  const searching = debounced.length >= 2;
  const { data: results, isFetching, isError } = useUserSearch(debounced);

  const invite = () => {
    void Share.share({
      message: t('onboarding.friends.inviteMessage', {
        url: `${origin ?? ''}/users/${encodeURIComponent(username)}`,
      }),
    });
  };

  const people = searching
    ? (results ?? []).filter((person) => person.friendState !== 'self')
    : [...requested.values(), ...selected.values()];

  let body: ReactNode;
  if (searching && isError) {
    body = (
      <Text style={[type.bodySm, text.pink]} accessibilityRole="alert">
        {t('onboarding.friends.searchFailed')}
      </Text>
    );
  } else if (searching && isFetching && people.length === 0) {
    body = <ActivityIndicator color={color.pink} style={styles.loading} />;
  } else if (people.length > 0) {
    body = (
      <View style={styles.people}>
        {people.map((person) => (
          <FriendRow
            key={person.id}
            person={person}
            picked={selected.has(person.id)}
            requested={requested.has(person.id)}
            onToggle={() => onToggle(person)}
          />
        ))}
      </View>
    );
  } else {
    body = (
      <Text style={styles.emptyBox}>
        {searching
          ? t('onboarding.friends.noMatches', { query: debounced })
          : t('onboarding.friends.empty')}
      </Text>
    );
  }

  return (
    <>
      <View style={styles.search}>
        <Icon name="search" color={color.dim} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('onboarding.friends.searchPlaceholder')}
          placeholderTextColor={color.dim}
          accessibilityLabel={t('onboarding.friends.searchAria')}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.searchInput}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.friends.inviteAria')}
          onPress={invite}
          style={({ pressed }) => [styles.inviteLink, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[styles.smallLabel, text.muted]}>{t('onboarding.friends.invite')}</Text>
        </Pressable>
      </View>

      {people.length > 0 ? (
        <Text style={[styles.smallLabel, text.dim, styles.listLabel]}>
          {searching ? t('onboarding.friends.results') : t('onboarding.friends.selected')}
        </Text>
      ) : null}

      {body}

      {error ? (
        <Text style={[type.bodySm, text.pink]} accessibilityRole="alert">
          {t('onboarding.friends.sendFailed')}
        </Text>
      ) : null}
    </>
  );
}

const SETTLED_KEY = {
  friends: 'onboarding.friends.already',
  outgoing: 'onboarding.friends.pending',
  incoming: 'onboarding.friends.incoming',
} as const;

function FriendRow({
  person,
  picked,
  requested,
  onToggle,
}: {
  person: UserSearchResult;
  picked: boolean;
  requested: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const settled =
    person.friendState === 'friends' ||
    person.friendState === 'outgoing' ||
    person.friendState === 'incoming';

  return (
    <View style={styles.personRow}>
      <Avatar name={person.username} image={person.image} size={38} />
      <View style={styles.sourceText}>
        <Text style={styles.personName} numberOfLines={1}>
          {person.name}
        </Text>
        <Text style={[styles.sourceNote, text.muted]} numberOfLines={1}>
          @{person.username}
        </Text>
      </View>
      {requested ? (
        <RowAction label={t('onboarding.friends.requested')} tone="on" icon="check" />
      ) : settled ? (
        <RowAction
          label={t(SETTLED_KEY[person.friendState as keyof typeof SETTLED_KEY])}
          tone="quiet"
        />
      ) : (
        <RowAction
          label={picked ? t('onboarding.friends.picked') : t('onboarding.friends.add')}
          tone={picked ? 'on' : 'idle'}
          icon={picked ? 'check' : 'plus'}
          accessibilityLabel={
            picked
              ? t('onboarding.friends.unpickAria', { name: person.name })
              : t('onboarding.friends.addAria', { name: person.name })
          }
          onPress={onToggle}
        />
      )}
    </View>
  );
}

function DoneStep({ names, sent }: { names: string[]; sent: number }) {
  const { t } = useTranslation();
  return (
    <>
      <View style={styles.recap}>
        <Recap
          label={t('onboarding.done.sources')}
          value={names.length}
          note={
            names.length > 0
              ? t('onboarding.done.sourcesNote', { names: names.join(', ') })
              : t('onboarding.done.sourcesNone')
          }
        />
        <Recap
          label={t('onboarding.done.requests')}
          value={sent}
          note={sent > 0 ? t('onboarding.done.requestsNote') : t('onboarding.done.requestsNone')}
          divided
        />
      </View>
      <Text style={styles.closing}>
        {names.length > 0 ? t('onboarding.done.noteImport') : t('onboarding.done.noteEmpty')}
      </Text>
    </>
  );
}

function Recap({
  label,
  value,
  note,
  divided = false,
}: {
  label: string;
  value: number;
  note: string;
  divided?: boolean;
}) {
  return (
    <View style={[styles.recapCell, divided && styles.recapDivided]}>
      <Text style={[styles.smallLabel, text.dim]}>{label}</Text>
      <View style={styles.shrink}>
        <PrismText style={styles.recapValue}>{String(value)}</PrismText>
      </View>
      <Text style={[styles.sourceNote, text.muted]}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  body: {
    paddingTop: 18,
    paddingBottom: space.lg,
    paddingHorizontal: layout.gutter,
  },
  stack: {
    gap: space.lg,
  },
  intro: {
    gap: space.sm,
  },
  title: {
    fontFamily: font.display,
    fontSize: 34,
    lineHeight: displayLine(34),
    color: color.fg,
  },
  lede: {
    fontFamily: font.body,
    fontSize: 15,
    lineHeight: 22,
    color: color.muted,
  },
  loading: {
    paddingVertical: space.xl,
  },
  rows: {
    gap: space.sm,
  },
  sourceRow: {
    gap: space.md,
    paddingVertical: 11,
    paddingHorizontal: space.md,
    borderRadius: radius.cardSm,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  sourceRowOn: {
    borderColor: 'rgba(217,107,176,0.55)',
    backgroundColor: 'rgba(217,107,176,0.10)',
  },
  sourceLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  sourceText: {
    flex: 1,
    minWidth: 0,
    gap: space.xs,
  },
  sourceNote: {
    fontFamily: font.body,
    fontSize: 12,
    lineHeight: 16,
  },
  header: {
    paddingHorizontal: layout.gutter,
  },
  rowAction: {
    width: ROW_ACTION_WIDTH,
    flexShrink: 0,
  },
  rowQuiet: {
    width: ROW_ACTION_WIDTH,
    height: control.inRow,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: layout.touchTarget,
    paddingHorizontal: 14,
    // Same lift as `Field`: iOS draws single-line input text a few points low.
    paddingTop: 0,
    paddingBottom: 6,
    borderRadius: radius.cover,
    borderWidth: stroke,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    color: color.fg,
  },
  note: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: 0.8,
    color: color.dim,
  },
  emptyBox: {
    borderWidth: stroke,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: radius.cardSm,
    padding: 18,
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 21,
    color: color.muted,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    paddingLeft: 14,
    borderRadius: radius.cover,
    borderWidth: stroke,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: space.md,
    fontFamily: font.body,
    fontSize: 16,
    color: color.fg,
  },
  inviteLink: {
    height: 50,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  smallLabel: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: 1.2,
    includeFontPadding: false,
  },
  listLabel: {
    marginBottom: -space.sm,
  },
  people: {
    flexDirection: 'column',
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 10,
    borderBottomWidth: stroke,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  personName: {
    fontFamily: font.bodySemibold,
    fontSize: 15,
    lineHeight: 19,
    color: color.fg,
  },
  recap: {
    flexDirection: 'row',
    borderRadius: radius.card,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  recapCell: {
    flex: 1,
    padding: space.lg,
    gap: 6,
  },
  recapDivided: {
    borderLeftWidth: stroke,
    borderLeftColor: surface.divider,
  },
  shrink: {
    alignSelf: 'flex-start',
  },
  recapValue: {
    fontFamily: font.display,
    fontSize: 34,
    lineHeight: displayLine(34),
  },
  closing: {
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 21,
    color: color.muted,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: space.md,
    paddingHorizontal: layout.gutter,
    borderTopWidth: stroke,
    borderTopColor: surface.divider,
  },
  backDisc: {
    width: control.secondary,
    height: control.secondary,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: stroke,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  skip: {
    flex: 1,
    height: control.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipLabel: {
    fontFamily: font.bodyBold,
    fontSize: 13,
    letterSpacing: 0.78,
    color: '#cfc9d8',
    textDecorationLine: 'underline',
    textDecorationColor: 'rgba(255,255,255,0.3)',
    includeFontPadding: false,
  },
  footerLabel: {
    fontFamily: font.bodyBold,
    fontSize: 13,
    letterSpacing: 0.78,
    includeFontPadding: false,
  },
  primary: {
    height: control.primary,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  primaryFill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
  primaryIdle: {
    backgroundColor: surface.glassWell,
  },
});
