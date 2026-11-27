import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { authErrorKey } from '@trackt/client';
import { Field } from '../../src/components/Field';
import { GlassCard } from '../../src/components/GlassCard';
import { PasswordToggle } from '../../src/components/PasswordToggle';
import { PrismButton } from '../../src/components/PrismButton';
import { PrismText } from '../../src/components/PrismText';
import { Screen } from '../../src/components/Screen';
import { authClient, localeHeaders } from '../../src/lib/auth-client';
import { color, space } from '../../src/theme/tokens';
import { useTranslation } from 'react-i18next';
import { type } from '../../src/theme/typography';

/** Mirrors `apps/web/src/routes/login.tsx` — same two fields, same better-auth call. */
export default function Login() {
  const router = useRouter();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setFormError(null);
    const { error } = await authClient().signIn.email({
      email: email.trim(),
      password,
      ...localeHeaders(),
    });
    setSubmitting(false);
    // The server has already mailed a fresh code.
    if (error?.code === 'EMAIL_NOT_VERIFIED') {
      router.push({ pathname: '/verify', params: { email: email.trim() } });
      return;
    }
    if (error) {
      setFormError(t(authErrorKey(error, 'errors.signInFailed')));
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
          placeholder={t('auth.passwordHint.login')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          trailing={
            <PasswordToggle
              shown={showPassword}
              onToggle={() => setShowPassword((current) => !current)}
            />
          }
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
});
