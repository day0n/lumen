'use client';

import { useAuth, useClerk } from '@clerk/nextjs';
import { useCallback } from 'react';

export function useLoginRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();

  const redirectToLogin = useCallback(
    (target?: string) => {
      if (!isLoaded) return false;
      if (isSignedIn) return true;

      const redirectUrl = resolveRedirectUrl(target);
      void clerk.redirectToSignIn({
        redirectUrl,
        signInFallbackRedirectUrl: redirectUrl,
      });
      return false;
    },
    [clerk, isLoaded, isSignedIn],
  );

  return {
    isLoaded,
    isSignedIn: Boolean(isSignedIn),
    redirectToLogin,
    requireLogin: redirectToLogin,
  };
}

function resolveRedirectUrl(target?: string) {
  if (target) {
    if (/^https?:\/\//i.test(target)) return target;
    return target.startsWith('/') ? target : `/${target}`;
  }

  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
