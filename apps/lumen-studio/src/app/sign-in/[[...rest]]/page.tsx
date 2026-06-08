import { AuthPageShell } from '@/components/auth/AuthPageShell';
import { ClerkAuthShell } from '@/components/auth/ClerkAuthShell';
import { localePath } from '@/i18n/routing';
import { getRequestLocale } from '@/i18n/server';
import { SignIn } from '@clerk/nextjs';

export default async function SignInPage() {
  const locale = await getRequestLocale();

  return (
    <AuthPageShell locale={locale}>
      <ClerkAuthShell>
        <SignIn
          routing="path"
          path={localePath('/sign-in', locale)}
          signUpUrl={localePath('/sign-up', locale)}
        />
      </ClerkAuthShell>
    </AuthPageShell>
  );
}
