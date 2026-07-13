import { useAuth } from '@clerk/react';
import { useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { currentAppRedirectUrl } from '../../lib/path-map';
import { AppRouteFallback } from '../routing/AppRouteFallback';
import { isPublicEntryPath } from './public-entry-path';

const SIGN_IN_REDIRECT_GRACE_MS = 1500;

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const location = useLocation();
  const allowPublicEntry = isPublicEntryPath(location.pathname);

  useEffect(() => {
    if (allowPublicEntry) return;
    if (!isLoaded || isSignedIn) return;
    const timeout = window.setTimeout(() => {
      window.location.assign(
        `/sign-in?redirect_url=${encodeURIComponent(currentAppRedirectUrl())}`,
      );
    }, SIGN_IN_REDIRECT_GRACE_MS);
    return () => window.clearTimeout(timeout);
  }, [allowPublicEntry, isLoaded, isSignedIn]);

  if (allowPublicEntry) {
    return children;
  }

  if (!isLoaded || !isSignedIn) {
    return <AppRouteFallback />;
  }

  return children;
}
