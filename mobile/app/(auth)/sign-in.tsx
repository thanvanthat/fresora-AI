import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, PrimaryButton } from '../../src/components/Button';
import { Field } from '../../src/components/Controls';
import { InfoCard } from '../../src/components/FoodCard';
import { Gutter, Screen } from '../../src/components/Screen';
import { Body, Display } from '../../src/components/Text';
import { signInSchema, validate } from '../../src/features/auth/validation';
import { useTranslation } from '../../src/i18n';
import { AuthError, signIn } from '../../src/services/auth';
import { setSignedIn } from '../../src/services/storage';
import { useAppStore } from '../../src/store/app';
import { spacing } from '../../src/theme';

export default function SignInScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const setSession = useAppStore((state) => state.setSession);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setFormError(null);

    const fieldErrors = validate(signInSchema, { email, password });
    if (fieldErrors) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setBusy(true);

    try {
      const user = await signIn(email, password);
      setSignedIn(true);
      setSession(user.id, {
        id: user.id,
        full_name: user.fullName,
        email: user.email,
        avatar_url: null,
        created_at: new Date().toISOString(),
      });
      router.replace('/(tabs)');
    } catch (error) {
      // Only the mapped key reaches the screen -- provider text is never shown.
      setFormError(
        error instanceof AuthError ? t(error.messageKey) : t('errors.genericBody'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen showBack tabBarPadding={false} keyboardAware>
      <Gutter style={styles.container}>
        <Display>{t('auth.signIn')}</Display>
        <Body style={styles.subtitle}>{t('common.tagline')}</Body>

        {formError ? (
          <InfoCard title={t('errors.genericTitle')} body={formError} icon="alert-triangle" tone="warning" />
        ) : null}

        <Field
          label={t('auth.email')}
          value={email}
          onChangeText={setEmail}
          error={errors.email ? t(errors.email) : undefined}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          placeholder="you@example.com"
        />

        <Field
          label={t('auth.password')}
          value={password}
          onChangeText={setPassword}
          error={errors.password ? t(errors.password) : undefined}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password"
        />

        <Button
          label={t('auth.forgotPassword')}
          variant="ghost"
          size="sm"
          fullWidth={false}
          onPress={() => router.push('/(auth)/forgot-password')}
          style={styles.forgot}
        />

        <PrimaryButton
          label={busy ? t('auth.signingIn') : t('auth.signIn')}
          size="lg"
          loading={busy}
          onPress={onSubmit}
          style={styles.submit}
        />

        <View style={styles.footer}>
          <Body>{t('auth.noAccount')}</Body>
          <Button
            label={t('auth.signUp')}
            variant="ghost"
            size="sm"
            fullWidth={false}
            onPress={() => router.replace('/(auth)/sign-up')}
          />
        </View>
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
    marginBottom: spacing.sm,
  },
  forgot: {
    alignSelf: 'flex-end',
    marginTop: -spacing.sm,
  },
  submit: {
    marginTop: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.base,
  },
});
