import { AuroraBackdrop } from '@/components/home/AuroraBackdrop';
import { LumenMark } from '@/components/ui/LumenMark';
import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-6 py-12 text-white">
      <AuroraBackdrop />
      <div className="relative z-10 flex w-full max-w-[440px] flex-col items-center gap-8">
        <a href="/" className="flex items-center gap-3">
          <LumenMark size={36} />
          <span className="font-display text-[18px] font-bold tracking-tight text-white">
            Lumen
          </span>
        </a>
        <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
      </div>
    </main>
  );
}
