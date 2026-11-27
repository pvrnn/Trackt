import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { authErrorKey } from '@trackt/client';
import { isDisposableEmail } from '@trackt/shared/disposable-email';
import { Field } from '../../src/components/Field';
import { GlassCard } from '../../src/components/GlassCard';
import { PasswordToggle } from '../../src/components/PasswordToggle';
import { PrismButton } from '../../src/components/PrismButton';
import { PrismText } from '../../src/components/PrismText';
import { Screen } from '../../src/components/Screen';
import { authClient, localeHeaders } from '../../src/lib/auth-client';
import { color, space } from '../../src/theme/tokens';
import { type } from '../../src/theme/typography';

/** Mirrors web's `RegisterForm`: better-auth's username-plugin rule and the server's password minimum. */
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,30}$/;
const MIN_PASSWORD_LENGTH = 8;

interface Fields {
  username: string;
  email: string;
  password: string;
}

type ValidationKey =
  | 'auth.validation.usernameFormat'
  | 'auth.validation.emailRequired'
  | 'auth.validation.disposableEmail'
  | 'auth.validation.passwordLength';

function validate(f: Fields): Partial<Record<keyof Fields, ValidationKey>> {
  const errors: Partial<Record<keyof Fields, ValidationKey>> = {};
  if (!USERNAME_RE.test(f.username)) errors.username = 'auth.validation.usernameFormat';
  if (!f.email.trim()) errors.email = 'auth.validation.emailRequired';
  else if (isDisposableEmail(f.email)) errors.email = 'auth.validation.disposableEmail';
  if (f.password.length < MIN_PASSWORD_LENGTH) errors.password = 'auth.validation.passwordLength';
  return errors;
}

/** Username, email and password; the display name starts as the username. */
export default function Register() {
  const router = useRouter();
  const { t } = useTranslation();
  const [fields, setFields] = useState<Fields>({ username: '', email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Fields, ValidationKey>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const set = (key: keyof Fields) => (value: string) => setFields((f) => ({ ...f, [key]: value }));
  const error = (key: keyof Fields) =>
    fieldErrors[key] && t(fieldErrors[key], { min: MIN_PASSWORD_LENGTH });

  async function submit() {
    const errors = validate(fields);
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    const email = fields.email.trim();
    const { data, error: signUpError } = await authClient().signUp.email({
      // The display name starts as the username; it is editable on the profile.
      name: fields.username,
      email,
      password: fields.password,
      username: fields.username,
      ...localeHeaders(),
    });
    setSubmitting(false);
    if (signUpError?.code === 'DISPOSABLE_EMAIL') {
      setFieldErrors({ email: 'auth.validation.disposableEmail' });
      return;
    }
    if (signUpError) {
      setFormError(t(authErrorKey(signUpError, 'errors.signUpFailed')));
      return;
    }
    // No token: the instance requires a verified email, and the code is on its way.
    if (!data?.token) {
      router.replace({ pathname: '/verify', params: { email } });
      return;
    }
    router.replace('/onboarding');
  }

  return (
    <Screen center auraIntensity={1.6}>
      <View style={styles.header}>
        <PrismText style={type.title}>{t('auth.register.title').toUpperCase()}</PrismText>
        <Text style={[type.body, styles.lede]}>{t('auth.register.subtitle')}</Text>
      </View>

      <GlassCard strongBorder style={styles.card}>
        <Field
          label={t('auth.fields.username')}
          placeholder="marav"
          value={fields.username}
          onChangeText={set('username')}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username-new"
          textContentType="username"
          error={error('username')}
        />
        <Field
          label={t('auth.fields.email')}
          placeholder="you@example.com"
          value={fields.email}
          onChangeText={set('email')}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          error={error('email')}
        />
        <Field
          label={t('auth.fields.password')}
          placeholder={t('auth.passwordHint.register')}
          value={fields.password}
          onChangeText={set('password')}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          error={error('password')}
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
          label={submitting ? t('auth.creatingAccount') : t('auth.createAccount')}
          onPress={() => void submit()}
          busy={submitting}
        />
      </GlassCard>

      <PrismButton
        label={t('auth.alreadyMember')}
        variant="secondary"
        onPress={() => router.back()}
      />
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
  error: {
    color: color.pink,
  },
});
