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
  if (!f.name.trim()) errors.name = 'Name is required';
  if (!USERNAME_RE.test(f.username))
    errors.username = '3–30 characters: letters, numbers, dots, underscores';
  if (!f.email.trim()) errors.email = 'Email is required';
  if (f.password.length < MIN_PASSWORD_LENGTH)
    errors.password = `At least ${MIN_PASSWORD_LENGTH} characters`;
  if (f.confirm !== f.password) errors.confirm = 'Passwords do not match';
  return errors;
}

const EMPTY: Fields = { name: '', username: '', email: '', password: '', confirm: '' };

export default function Register() {
  const router = useRouter();
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
      setFormError(error.message ?? 'Sign up failed');
      return;
    }
    router.replace('/home');
  }

  return (
    <Screen center auraIntensity={1.6}>
      <View style={styles.header}>
        <PrismText style={type.title}>CREATE ACCOUNT</PrismText>
        <Text style={[type.body, styles.lede]}>
          Your history, ratings, and lists — exportable any time.
        </Text>
      </View>

      <GlassCard strongBorder style={styles.card}>
        <Field
          label="Name"
          value={fields.name}
          onChangeText={set('name')}
          autoComplete="name"
          error={fieldErrors.name}
        />
        <Field
          label="Username"
          placeholder="handle"
          value={fields.username}
          onChangeText={set('username')}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username-new"
          error={fieldErrors.username}
        />
        <Field
          label="Email"
          placeholder="you@example.com"
          value={fields.email}
          onChangeText={set('email')}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          error={fieldErrors.email}
        />
        <Field
          label="Password"
          placeholder="••••••••••"
          value={fields.password}
          onChangeText={set('password')}
          secureTextEntry
          autoComplete="new-password"
          error={fieldErrors.password}
        />
        <Field
          label="Confirm password"
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
        <PrismButton label="Create account" onPress={() => void submit()} busy={submitting} />
      </GlassCard>

      <PrismButton label="Back to sign in" variant="secondary" onPress={() => router.back()} />
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
