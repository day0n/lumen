import { ClerkAuthShell } from '@/components/auth/ClerkAuthShell';
import { AuroraBackdrop } from '@/components/home/AuroraBackdrop';
import { LumenMark } from '@/components/ui/LumenMark';
import { localePath } from '@/i18n/routing';
import { getRequestLocale } from '@/i18n/server';
import { SignIn } from '@clerk/nextjs';

export default async function SignInPage() {
  const locale = await getRequestLocale();

  return (
    <main className="relative flex min-h-screen items-center justify-center px-6 py-12 text-white">
      <AuroraBackdrop />
      <div className="relative z-10 flex w-full max-w-[440px] flex-col items-center gap-8">
        <a href={localePath('/', locale)} className="flex items-center gap-3">
          <LumenMark size={36} />
          <span className="font-display text-[18px] font-bold tracking-tight text-white">
            Lumen
          </span>
        </a>
        <ClerkAuthShell>
          <SignIn
            routing="path"
            path={localePath('/sign-in', locale)}
            signUpUrl={localePath('/sign-up', locale)}
          />
        </ClerkAuthShell>
      </div>
    </main>
  );
}
