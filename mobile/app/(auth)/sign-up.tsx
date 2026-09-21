import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, PrimaryButton } from '../../src/components/Button';
import { Field } from '../../src/components/Controls';
import { InfoCard } from '../../src/components/FoodCard';
import { Gutter, Screen } from '../../src/components/Screen';
import { Body, Display } from '../../src/components/Text';
import { SafetyNotice } from '../../src/components/States';
import { useToast } from '../../src/components/Toast';
import { signUpSchema, validate } from '../../src/features/auth/validation';
import { useTranslation } from '../../src/i18n';
import { AuthError, signUp } from '../../src/services/auth';
import { getStore, setSignedIn } from '../../src/services/storage';
import { useAppStore } from '../../src/store/app';
import { spacing } from '../../src/theme';

export default function SignUpScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const setSession = useAppStore((state) => state.setSession);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setFormError(null);

    const fieldErrors = validate(signUpSchema, {
      fullName,
      email,
      password,
      confirmPassword,
    });
    if (fieldErrors) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setBusy(true);

    try {
      const user = await signUp(fullName, email, password);

      if (!user) {
        // Email confirmation is on: there is no session yet, so say so rather
        // than dropping the user into an app that thinks they are signed out.
        toast.show(t('auth.resetSent'));
        router.replace('/(auth)/sign-in');
        return;
      }

      setSignedIn(true);
      await getStore().saveProfile({ full_name: fullName, email: user.email });
      setSession(user.id, {
        id: user.id,
        full_name: fullName,
        email: user.email,
        avatar_url: null,
        created_at: new Date().toISOString(),
      });
      router.replace('/(tabs)');
    } catch (error) {
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
        <Display>{t('auth.signUp')}</Display>
        <Body style={styles.subtitle}>{t('common.tagline')}</Body>

        {formError ? (
          <InfoCard
            title={t('errors.genericTitle')}
            body={formError}
            icon="alert-triangle"
            tone="warning"
          />
        ) : null}

        <Field
          label={t('auth.fullName')}
          value={fullName}
          onChangeText={setFullName}
          error={errors.fullName ? t(errors.fullName) : undefined}
          autoCapitalize="words"
          autoComplete="name"
        />

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
          hint={t('auth.passwordTooShort')}
        />

        <Field
          label={t('auth.confirmPassword')}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          error={errors.confirmPassword ? t(errors.confirmPassword) : undefined}
          secureTextEntry
          autoCapitalize="none"
        />

        <PrimaryButton
          label={busy ? t('auth.creatingAccount') : t('auth.signUp')}
          size="lg"
          loading={busy}
          onPress={onSubmit}
          style={styles.submit}
        />

        <View style={styles.footer}>
          <Body>{t('auth.hasAccount')}</Body>
          <Button
            label={t('auth.signIn')}
            variant="ghost"
            size="sm"
            fullWidth={false}
            onPress={() => router.replace('/(auth)/sign-in')}
          />
        </View>

        <SafetyNotice text={t('safety.shortNotice')} compact />
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
  submit: {
    marginTop: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
});
