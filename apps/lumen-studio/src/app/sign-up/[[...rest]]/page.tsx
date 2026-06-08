import { AuthPageShell } from '@/components/auth/AuthPageShell';
import { ClerkAuthShell } from '@/components/auth/ClerkAuthShell';
import { localePath } from '@/i18n/routing';
import { getRequestLocale } from '@/i18n/server';
import { SignUp } from '@clerk/nextjs';

export default async function SignUpPage() {
  const locale = await getRequestLocale();

  return (
    <AuthPageShell locale={locale}>
      <ClerkAuthShell>
        <SignUp
          routing="path"
          path={localePath('/sign-up', locale)}
          signInUrl={localePath('/sign-in', locale)}
        />
      </ClerkAuthShell>
    </AuthPageShell>
  );
}
