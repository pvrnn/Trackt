import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { authErrorKey } from '@trackt/client';
import { Field } from '../../src/components/Field';
import { GlassCard } from '../../src/components/GlassCard';
import { PrismButton } from '../../src/components/PrismButton';
import { PrismText } from '../../src/components/PrismText';
import { Screen } from '../../src/components/Screen';
import { authClient, localeHeaders } from '../../src/lib/auth-client';
import { color, space } from '../../src/theme/tokens';
import { font, type } from '../../src/theme/typography';

const CODE_RE = /^\d{6}$/;
const RESEND_COOLDOWN_S = 30;

/**
 * Mirrors web's `/verify-email`: the 6-digit code from the verification email.
 * The email's link opens the web page, so here the code is typed.
 */
export default function Verify() {
  const router = useRouter();
  const { t } = useTranslation();
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function submit() {
    if (!email) return;
    const otp = code.trim();
    setNotice(null);
    if (!CODE_RE.test(otp)) {
      setFormError(t('auth.verify.codeFormat'));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    const { error } = await authClient().emailOtp.verifyEmail({ email, otp });
    setSubmitting(false);
    if (error) {
      setFormError(t(authErrorKey(error, 'errors.verifyFailed')));
      return;
    }
    router.replace('/onboarding');
  }

  async function resend() {
    if (!email || cooldown > 0) return;
    setFormError(null);
    setCooldown(RESEND_COOLDOWN_S);
    const { error } = await authClient().emailOtp.sendVerificationOtp({
      email,
      type: 'email-verification',
      ...localeHeaders(),
    });
    if (error) {
      setFormError(t(authErrorKey(error, 'errors.generic')));
      return;
    }
    setNotice(t('auth.verify.resent'));
  }

  if (!email) {
    return (
      <Screen center auraIntensity={1.6}>
        <PrismText style={type.title}>{t('auth.verify.title').toUpperCase()}</PrismText>
        <Text style={[type.body, styles.lede]}>{t('auth.verify.noEmail')}</Text>
        <PrismButton
          label={t('auth.alreadyMember')}
          variant="secondary"
          onPress={() => router.replace('/login')}
        />
      </Screen>
    );
  }

  return (
    <Screen center auraIntensity={1.6}>
      <View style={styles.header}>
        <PrismText style={type.title}>{t('auth.verify.title').toUpperCase()}</PrismText>
        <Text style={[type.body, styles.lede]}>
          {t('auth.verify.sentTo')} <Text style={styles.email}>{email}</Text>
        </Text>
      </View>

      <GlassCard strongBorder style={styles.card}>
        <Field
          label={t('auth.verify.codeLabel')}
          placeholder="123456"
          value={code}
          onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          style={styles.code}
        />
        {formError ? (
          <Text style={[type.bodySm, styles.error]} accessibilityRole="alert">
            {formError}
          </Text>
        ) : null}
        {notice ? <Text style={[type.bodySm, styles.lede]}>{notice}</Text> : null}
        <PrismButton
          label={submitting ? t('auth.verify.submitting') : t('auth.verify.submit')}
          onPress={() => void submit()}
          busy={submitting}
        />
      </GlassCard>

      <Text style={[type.bodySm, styles.lede]}>
        {t('auth.verify.noCode')}{' '}
        <Text
          accessibilityRole="button"
          accessibilityState={{ disabled: cooldown > 0 }}
          onPress={cooldown > 0 ? undefined : () => void resend()}
          style={cooldown > 0 ? styles.resendWaiting : styles.resend}
        >
          {cooldown > 0
            ? t('auth.verify.resendIn', { seconds: cooldown })
            : t('auth.verify.resend')}
        </Text>
      </Text>
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
  email: {
    color: color.fg,
  },
  card: {
    padding: space.xl,
    gap: space.lg,
  },
  code: {
    letterSpacing: 6,
  },
  error: {
    color: color.pink,
  },
  resend: {
    fontFamily: font.bodyBold,
    color: color.pink,
  },
  resendWaiting: {
    fontFamily: font.bodyBold,
    color: color.dim,
  },
});
