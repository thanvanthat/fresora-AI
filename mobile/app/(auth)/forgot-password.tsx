import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button, PrimaryButton } from '../../src/components/Button';
import { Field } from '../../src/components/Controls';
import { InfoCard } from '../../src/components/FoodCard';
import { Gutter, Screen } from '../../src/components/Screen';
import { Body, Display } from '../../src/components/Text';
import { SUPABASE_CONFIGURED } from '../../src/constants/config';
import { emailSchema, validate } from '../../src/features/auth/validation';
import { useTranslation } from '../../src/i18n';
import { AuthError, requestPasswordReset } from '../../src/services/auth';
import { spacing } from '../../src/theme';
import { z } from 'zod';

/**
 * Password reset request.
 *
 * Deliberately does not reveal whether an address has an account: a reset is
 * reported as sent either way, so this screen cannot be used to enumerate
 * registered users. Supabase behaves the same way on its side.
 */
export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setFormError(null);

    const fieldErrors = validate(z.object({ email: emailSchema }), { email });
    if (fieldErrors) {
      setError(t(fieldErrors.email));
      return;
    }
    setError(null);
    setBusy(true);

    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (caught) {
      // A "user not found" is not surfaced -- see the note above. Only real
      // failures (no network, unconfigured project) reach the user.
      if (caught instanceof AuthError && caught.messageKey === 'auth.notConfigured') {
        setFormError(t('auth.notConfigured'));
      } else if (caught instanceof AuthError) {
        setFormError(t(caught.messageKey));
      } else {
        setFormError(t('errors.genericBody'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen showBack tabBarPadding={false} keyboardAware>
      <Gutter style={styles.container}>
        <Display>{t('auth.resetPassword')}</Display>

        {!SUPABASE_CONFIGURED ? (
          <InfoCard
            title={t('auth.notConfigured')}
            body={t('auth.offlineExplainer')}
            icon="info"
            tone="sage"
          />
        ) : sent ? (
          <>
            <InfoCard
              title={t('auth.resetSent')}
              body={email}
              icon="check"
              tone="sage"
            />
            <PrimaryButton
              label={t('auth.signIn')}
              size="lg"
              onPress={() => router.replace('/(auth)/sign-in')}
            />
          </>
        ) : (
          <>
            <Body style={styles.subtitle}>{t('auth.resetSent')}</Body>

            {formError ? (
              <InfoCard
                title={t('errors.genericTitle')}
                body={formError}
                icon="alert-triangle"
                tone="warning"
              />
            ) : null}

            <Field
              label={t('auth.email')}
              value={email}
              onChangeText={setEmail}
              error={error ?? undefined}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              placeholder="you@example.com"
            />

            <PrimaryButton
              label={t('auth.resetPassword')}
              size="lg"
              loading={busy}
              onPress={onSubmit}
              style={styles.submit}
            />

            <Button
              label={t('auth.signIn')}
              variant="ghost"
              onPress={() => router.replace('/(auth)/sign-in')}
            />
          </>
        )}
      </Gutter>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  subtitle: {
    marginTop: -spacing.sm,
  },
  submit: {
    marginTop: spacing.sm,
  },
});
