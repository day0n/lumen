import { AuthPageShell } from '@/components/auth/AuthPageShell';
import { ClerkAuthShell } from '@/components/auth/ClerkAuthShell';
import { translate } from '@/i18n/messages';
import { localePath } from '@/i18n/routing';
import { getRequestLocale } from '@/i18n/server';
import { SignIn } from '@clerk/nextjs';
import Link from 'next/link';

export default async function SignInPage() {
  const locale = await getRequestLocale();
  const signUpHref = localePath('/sign-up', locale);

  return (
    <AuthPageShell locale={locale}>
      <ClerkAuthShell>
        <SignIn
          routing="path"
          path={localePath('/sign-in', locale)}
          signUpUrl={signUpHref}
        />
      </ClerkAuthShell>
      <p className="mt-5 text-center text-[13px] text-white/55">
        {translate(locale, 'auth.noAccount')}{' '}
        <Link
          href={signUpHref}
          prefetch={false}
          className="font-medium text-white underline-offset-4 transition hover:underline"
        >
          {translate(locale, 'auth.signUpLink')}
        </Link>
      </p>
    </AuthPageShell>
  );
}
