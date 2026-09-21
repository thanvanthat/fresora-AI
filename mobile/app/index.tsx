import { Redirect } from 'expo-router';

import { SplashBrand } from '../src/features/splash/SplashBrand';
import { useAppStore } from '../src/store/app';

/**
 * Entry route: decides where the user actually lands.
 *
 * While `ready` is false the branded splash stays on screen, so there is never
 * a flash of Home before a redirect to onboarding.
 *
 * Auth is deliberately *not* a gate. In local mode there is no account to have,
 * so blocking entry would make the app unusable with no Supabase project. Sign
 * in is offered from the You tab instead.
 */
export default function Index() {
  const ready = useAppStore((state) => state.ready);
  const onboarded = useAppStore((state) => state.onboarded);

  if (!ready) return <SplashBrand />;
  if (!onboarded) return <Redirect href="/onboarding" />;

  return <Redirect href="/(tabs)" />;
}
