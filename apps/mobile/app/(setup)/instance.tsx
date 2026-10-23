import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Field } from '../../src/components/Field';
import { GlassCard } from '../../src/components/GlassCard';
import { PrismButton } from '../../src/components/PrismButton';
import { PrismText } from '../../src/components/PrismText';
import { Screen } from '../../src/components/Screen';
import { demoInstanceOrigin } from '../../src/lib/build-config';
import { useInstance } from '../../src/lib/instance-provider';
import { normalizeOrigin, probeInstance } from '../../src/lib/instance';
import { color, space } from '../../src/theme/tokens';
import { useTranslation } from 'react-i18next';
import { type } from '../../src/theme/typography';

/**
 * The first screen (ADR-0008 §2): a server picker, not a login form.
 *
 * Trackt has no canonical instance, so this is where the app learns what
 * "the server" means for this user. It never guesses — no default origin, no
 * suggestion list — and it never adopts an address it has not successfully
 * probed, because adopting a wrong one strands the user on a login screen that
 * can only fail.
 *
 * Phase 5 adds one address the app may *offer*, and only when the build was
 * given one: `extra.demoInstance`. That is not a default and not a guess — it
 * is a labelled button, and the probe still has to succeed before it is
 * adopted. It exists because a reviewer has no instance of their own, and a
 * store submission with nothing behind this field is a 4.2 rejection.
 */
export default function InstancePicker() {
  const router = useRouter();
  const { t } = useTranslation();
  const { origin, selectInstance } = useInstance();
  const [value, setValue] = useState(origin ?? '');
  // Read once: it is compiled into the build and cannot change while it runs.
  const [demo] = useState(demoInstanceOrigin);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // Aborts a probe still in flight when the user submits again — otherwise a
  // slow first address can resolve after a fast second one and win.
  const inFlight = useRef<AbortController | null>(null);

  const connect = useCallback(
    async (input: string) => {
      const normalized = normalizeOrigin(input);
      if (!normalized) {
        setError(t('errors.invalidInstanceAddress'));
        return;
      }

      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setChecking(true);
      setError(null);

      const result = await probeInstance(normalized, controller.signal);
      if (controller.signal.aborted) return;
      setChecking(false);

      if (!result.ok) {
        if (result.reason === 'unreachable') setError(t('errors.instanceUnreachableDetailed'));
        else if (result.reason === 'not-trackt') setError(t('errors.notTracktInstance'));
        else setError(t('errors.instanceTooOld', { version: result.version, min: '0.1.0' }));
        return;
      }
      await selectInstance(result.origin);
      router.replace('/login');
    },
    [selectInstance, router, t],
  );

  return (
    <Screen center auraIntensity={1.6}>
      <View style={styles.header}>
        <Text style={[type.eyebrow, styles.eyebrow]}>{t('nav.selfHost')}</Text>
        <PrismText style={type.hero}>TRACKT</PrismText>
        <Text style={[type.body, styles.lede]}>{t('instance.lede')}</Text>
      </View>

      <GlassCard strongBorder style={styles.card}>
        <Field
          label={t('instance.addressLabel')}
          placeholder="trackt.example.com"
          value={value}
          onChangeText={(next) => {
            setValue(next);
            setError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          textContentType="URL"
          returnKeyType="go"
          onSubmitEditing={() => void connect(value)}
          editable={!checking}
          error={error ?? undefined}
        />
        <PrismButton
          label={checking ? t('instance.connecting') : t('instance.connect')}
          onPress={() => void connect(value)}
          busy={checking}
        />
        <Text style={[type.bodySm, styles.hint]}>{t('instance.hint')}</Text>
        {/* Only when this build was given one (`app.config.ts`). The picker
            still never guesses: this is a labelled address, taken on purpose,
            and it exists so someone with no instance of their own — an App
            Review reviewer, most of all — has something to sign into. */}
        {demo ? (
          <PrismButton
            label={t('instance.useDemo')}
            variant="secondary"
            disabled={checking}
            onPress={() => void connect(demo)}
          />
        ) : null}
      </GlassCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: space.md,
  },
  eyebrow: {
    color: color.dim,
  },
  lede: {
    color: color.muted,
  },
  card: {
    padding: space.xl,
    gap: space.lg,
  },
  hint: {
    color: color.faint,
  },
});
