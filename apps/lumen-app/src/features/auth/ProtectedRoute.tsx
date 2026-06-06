import { useAuth } from '@clerk/react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { currentAppRedirectUrl } from '../../lib/path-map';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isLoaded || isSignedIn) return;
    window.location.assign(`/sign-in?redirect_url=${encodeURIComponent(currentAppRedirectUrl())}`);
  }, [isLoaded, isSignedIn]);

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0c0d0f] text-sm text-white/60">
        Loading Studio...
      </div>
    );
  }

  return children;
}
