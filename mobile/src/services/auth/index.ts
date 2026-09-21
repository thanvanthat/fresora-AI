import { SUPABASE_CONFIGURED } from '../../constants/config';
import { getSupabase } from '../supabase';

/**
 * Authentication.
 *
 * With Supabase configured, this is Supabase Auth. Without it, Fresora runs
 * in **local mode**: there is no account, the data lives on the device, and the
 * auth screens say so plainly rather than offering a sign-in that cannot work.
 *
 * Local mode is deliberately not a fake account system. There is no password
 * to check and nothing is encrypted, because there is no second user to keep
 * data from -- pretending otherwise would imply a protection that is not there.
 */

export interface AuthUser {
  id: string;
  email: string | null;
  fullName: string | null;
}

export type AuthMode = 'supabase' | 'local';

export class AuthError extends Error {
  /** i18n key the UI renders. Raw provider messages are never shown. */
  readonly messageKey: string;

  constructor(messageKey: string, detail?: string) {
    super(detail ?? messageKey);
    this.name = 'AuthError';
    this.messageKey = messageKey;
  }
}

export const authMode: AuthMode = SUPABASE_CONFIGURED ? 'supabase' : 'local';

/** Maps a Supabase error onto one of our dictionary keys. */
function mapAuthError(message: string): AuthError {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
    return new AuthError('auth.invalidCredentials', message);
  }
  if (lower.includes('already registered') || lower.includes('already exists')) {
    return new AuthError('auth.emailTaken', message);
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return new AuthError('errors.networkBody', message);
  }
  return new AuthError('errors.genericBody', message);
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  if (authMode === 'local') {
    throw new AuthError('auth.notConfigured');
  }

  const { data, error } = await getSupabase().auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw mapAuthError(error.message);
  if (!data.user) throw new AuthError('errors.genericBody');

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    fullName: (data.user.user_metadata?.full_name as string | undefined) ?? null,
  };
}

export async function signUp(
  fullName: string,
  email: string,
  password: string,
): Promise<AuthUser | null> {
  if (authMode === 'local') {
    throw new AuthError('auth.notConfigured');
  }

  const { data, error } = await getSupabase().auth.signUp({
    email: email.trim(),
    password,
    options: { data: { full_name: fullName.trim() } },
  });
  if (error) throw mapAuthError(error.message);

  // With email confirmation on, there is no session yet. Returning null lets
  // the UI show "check your inbox" instead of navigating into the app.
  if (!data.session || !data.user) return null;

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    fullName,
  };
}

export async function signOut(): Promise<void> {
  if (authMode === 'local') return;
  await getSupabase().auth.signOut();
}

export async function requestPasswordReset(email: string): Promise<void> {
  if (authMode === 'local') {
    throw new AuthError('auth.notConfigured');
  }
  const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim());
  if (error) throw mapAuthError(error.message);
}

/** The signed-in user, or null. Never throws: callers use it during start-up. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  if (authMode === 'local') return null;

  try {
    const { data } = await getSupabase().auth.getUser();
    if (!data.user) return null;
    return {
      id: data.user.id,
      email: data.user.email ?? null,
      fullName: (data.user.user_metadata?.full_name as string | undefined) ?? null,
    };
  } catch {
    return null;
  }
}

/** Subscribe to sign-in/sign-out. Returns an unsubscribe function. */
export function onAuthChange(listener: (user: AuthUser | null) => void): () => void {
  if (authMode === 'local') return () => undefined;

  const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
    listener(
      session?.user
        ? {
            id: session.user.id,
            email: session.user.email ?? null,
            fullName:
              (session.user.user_metadata?.full_name as string | undefined) ?? null,
          }
        : null,
    );
  });

  return () => data.subscription.unsubscribe();
}
