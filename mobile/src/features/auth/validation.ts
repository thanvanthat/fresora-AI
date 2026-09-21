import { z } from 'zod';

/**
 * Auth form validation.
 *
 * Messages are **i18n keys**, not sentences: Zod runs outside React, so it has
 * no access to the active language. The form resolves each key through `t()`
 * when it renders the error.
 */

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'auth.emailRequired')
  .email('auth.emailInvalid');

export const passwordSchema = z
  .string()
  .min(1, 'auth.passwordRequired')
  // 8 characters is the floor Supabase Auth enforces by default; validating it
  // here means the user finds out before a round trip.
  .min(8, 'auth.passwordTooShort');

export const signInSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const signUpSchema = z
  .object({
    fullName: z.string().trim().min(1, 'auth.nameRequired'),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'auth.passwordMismatch',
    path: ['confirmPassword'],
  });

export type SignInValues = z.infer<typeof signInSchema>;
export type SignUpValues = z.infer<typeof signUpSchema>;

/**
 * Validates and returns field errors keyed by field name.
 *
 * Returns null when valid. Keeps the screens free of Zod-specific handling.
 */
export function validate<T extends z.ZodTypeAny>(
  schema: T,
  values: unknown,
): Record<string, string> | null {
  const result = schema.safeParse(values);
  if (result.success) return null;

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? 'form');
    // Keep the first error per field: showing three at once is noise.
    if (!errors[field]) errors[field] = issue.message;
  }
  return errors;
}
