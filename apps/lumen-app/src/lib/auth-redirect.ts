'use client';

import { useAuth, useClerk } from '@clerk/react';
import { useCallback } from 'react';
import { toAppPath } from './path-map';

export function useLoginRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();

  const redirectToRegistration = useCallback(
    (target?: string) => {
      if (!isLoaded) return false;
      if (isSignedIn) return true;

      const redirectUrl = resolveRedirectUrl(target);
      void clerk.redirectToSignUp({
        redirectUrl,
        signInFallbackRedirectUrl: redirectUrl,
        signUpFallbackRedirectUrl: redirectUrl,
      });
      return false;
    },
    [clerk, isLoaded, isSignedIn],
  );

  return {
    isLoaded,
    isSignedIn: Boolean(isSignedIn),
    redirectToLogin: redirectToRegistration,
    redirectToRegistration,
    requireLogin: redirectToRegistration,
  };
}

function resolveRedirectUrl(target: string | undefined) {
  if (target) {
    if (/^https?:\/\//i.test(target)) return target;
    return toAppPath(target.startsWith('/') ? target : `/${target}`);
  }

  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
