import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Field } from '../../src/components/Field';
import { GlassCard } from '../../src/components/GlassCard';
import { PrismButton } from '../../src/components/PrismButton';
import { PrismText } from '../../src/components/PrismText';
import { Screen } from '../../src/components/Screen';
import { authClient } from '../../src/lib/auth-client';
import { color, space } from '../../src/theme/tokens';
import { useTranslation } from 'react-i18next';
import { i18n } from '../../src/i18n';
import { type } from '../../src/theme/typography';

/**
 * Mirrors `apps/web/src/routes/register.tsx`, including its client-side
 * validation — the rules are better-auth's username-plugin defaults and the
 * server's password minimum, and duplicating them here is what turns a 400 into
 * a message attached to the field that caused it.
 */
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,30}$/;
const MIN_PASSWORD_LENGTH = 8;

interface Fields {
  name: string;
  username: string;
  email: string;
  password: string;
  confirm: string;
}

type FieldErrors = Partial<Record<keyof Fields, string>>;

function validate(f: Fields): FieldErrors {
  const errors: FieldErrors = {};
  if (!f.name.trim()) errors.name = i18n.t('auth.validation.nameRequired');
  if (!USERNAME_RE.test(f.username)) errors.username = i18n.t('auth.validation.usernameFormat');
  if (!f.email.trim()) errors.email = i18n.t('auth.validation.emailRequired');
  if (f.password.length < MIN_PASSWORD_LENGTH)
    errors.password = i18n.t('auth.validation.passwordLength', { min: MIN_PASSWORD_LENGTH });
  if (f.confirm !== f.password) errors.confirm = i18n.t('auth.validation.passwordMismatch');
  return errors;
}

const EMPTY: Fields = { name: '', username: '', email: '', password: '', confirm: '' };

export default function Register() {
  const router = useRouter();
  const { t } = useTranslation();
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const set = (key: keyof Fields) => (value: string) => setFields((f) => ({ ...f, [key]: value }));

  async function submit() {
    const errors = validate(fields);
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    const { error } = await authClient().signUp.email({
      name: fields.name.trim(),
      email: fields.email.trim(),
      password: fields.password,
      username: fields.username,
    });
    setSubmitting(false);
    if (error) {
      setFormError(error.message ?? t('errors.signUpFailed'));
      return;
    }
    router.replace('/home');
  }

  return (
    <Screen center auraIntensity={1.6}>
      <View style={styles.header}>
        <PrismText style={type.title}>{t('auth.register.title').toUpperCase()}</PrismText>
        <Text style={[type.body, styles.lede]}>{t('auth.register.subtitle')}</Text>
      </View>

      <GlassCard strongBorder style={styles.card}>
        <Field
          label={t('auth.fields.name')}
          value={fields.name}
          onChangeText={set('name')}
          autoComplete="name"
          error={fieldErrors.name}
        />
        <Field
          label={t('auth.fields.username')}
          placeholder="handle"
          value={fields.username}
          onChangeText={set('username')}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username-new"
          error={fieldErrors.username}
        />
        <Field
          label={t('auth.fields.email')}
          placeholder="you@example.com"
          value={fields.email}
          onChangeText={set('email')}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          error={fieldErrors.email}
        />
        <Field
          label={t('auth.fields.password')}
          placeholder="••••••••••"
          value={fields.password}
          onChangeText={set('password')}
          secureTextEntry
          autoComplete="new-password"
          error={fieldErrors.password}
        />
        <Field
          label={t('auth.fields.confirmPassword')}
          placeholder="••••••••••"
          value={fields.confirm}
          onChangeText={set('confirm')}
          secureTextEntry
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          error={fieldErrors.confirm}
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
