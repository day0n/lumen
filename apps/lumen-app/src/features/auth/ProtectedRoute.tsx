import { useAuth } from '@clerk/react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { currentAppRedirectUrl } from '../../lib/path-map';
import { AppRouteFallback } from '../routing/AppRouteFallback';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isLoaded || isSignedIn) return;
    window.location.assign(`/sign-in?redirect_url=${encodeURIComponent(currentAppRedirectUrl())}`);
  }, [isLoaded, isSignedIn]);

  if (!isLoaded || !isSignedIn) {
    return <AppRouteFallback />;
  }

  return children;
}
