import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Field } from '../../src/components/Field';
import { GlassCard } from '../../src/components/GlassCard';
import { PrismButton } from '../../src/components/PrismButton';
import { PrismText } from '../../src/components/PrismText';
import { Screen } from '../../src/components/Screen';
import { authClient } from '../../src/lib/auth-client';
import { useInstance } from '../../src/lib/instance-provider';
import { color, space } from '../../src/theme/tokens';
import { useTranslation } from 'react-i18next';
import { type } from '../../src/theme/typography';

/** Mirrors `apps/web/src/routes/login.tsx` — same two fields, same better-auth call. */
export default function Login() {
  const router = useRouter();
  const { t } = useTranslation();
  const { origin, forgetInstance } = useInstance();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setFormError(null);
    const { error } = await authClient().signIn.email({ email: email.trim(), password });
    setSubmitting(false);
    if (error) {
      setFormError(error.message ?? t('errors.signInFailed'));
      return;
    }
    router.replace('/home');
  }

  return (
    <Screen center auraIntensity={1.6}>
      <View style={styles.header}>
        <PrismText style={type.title}>{t('auth.login.title').toUpperCase()}</PrismText>
        <Text style={[type.body, styles.lede]}>{t('auth.login.subtitle')}</Text>
      </View>

      <GlassCard strongBorder style={styles.card}>
        <Field
          label={t('auth.fields.email')}
          placeholder={t('auth.fields.email')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <Field
          label={t('auth.fields.password')}
          placeholder="••••••••••"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
        {formError ? (
          <Text style={[type.bodySm, styles.error]} accessibilityRole="alert">
            {formError}
          </Text>
        ) : null}
        <PrismButton
          label={submitting ? t('auth.submitting') : t('auth.submit')}
          onPress={() => void submit()}
          busy={submitting}
        />
      </GlassCard>

      <View style={styles.footer}>
        <PrismButton
          label={t('auth.createAccount')}
          variant="secondary"
          onPress={() => router.push('/register')}
        />
        {/*
          The way back out of a wrong instance. Without it a typo'd-but-live
          origin is a dead end: the picker is unreachable once one is stored,
          and reinstalling is the only other way to clear it.
        */}
        <Text
          accessibilityRole="button"
          style={[type.bodySm, styles.instance]}
          onPress={() => void forgetInstance()}
        >
          Connected to {origin} — tap to change server
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: space.md,
  },
  lede: {
    color: color.muted,
  },
  card: {
    padding: space.xl,
    gap: space.lg,
  },
  footer: {
    gap: space.lg,
  },
  error: {
    color: color.pink,
  },
  instance: {
    color: color.faint,
    textAlign: 'center',
  },
});
