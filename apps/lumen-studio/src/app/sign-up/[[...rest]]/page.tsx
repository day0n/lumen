import { AuthPageShell } from '@/components/auth/AuthPageShell';
import { ClerkAuthShell } from '@/components/auth/ClerkAuthShell';
import { InvitationGate } from '@/components/auth/InvitationGate';
import { localePath } from '@/i18n/routing';
import { getRequestLocale } from '@/i18n/server';
import { SignUp } from '@clerk/nextjs';

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getRequestLocale();
  const sp = await searchParams;
  const ticket = typeof sp.__clerk_ticket === 'string' ? sp.__clerk_ticket : null;

  if (ticket) {
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

  return (
    <AuthPageShell locale={locale}>
      <InvitationGate signInHref={localePath('/sign-in', locale)} />
    </AuthPageShell>
  );
}
