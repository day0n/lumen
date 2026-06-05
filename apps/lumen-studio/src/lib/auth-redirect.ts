'use client';

import { useI18n } from '@/i18n/provider';
import { useAuth, useClerk } from '@clerk/nextjs';
import { useCallback } from 'react';

export function useLoginRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();
  const { localePath } = useI18n();

  const redirectToRegistration = useCallback(
    (target?: string) => {
      if (!isLoaded) return false;
      if (isSignedIn) return true;

      const redirectUrl = resolveRedirectUrl(target, localePath);
      void clerk.redirectToSignUp({
        redirectUrl,
        signInFallbackRedirectUrl: redirectUrl,
        signUpFallbackRedirectUrl: redirectUrl,
      });
      return false;
    },
    [clerk, isLoaded, isSignedIn, localePath],
  );

  return {
    isLoaded,
    isSignedIn: Boolean(isSignedIn),
    redirectToLogin: redirectToRegistration,
    redirectToRegistration,
    requireLogin: redirectToRegistration,
  };
}

function resolveRedirectUrl(target: string | undefined, localePath: (href: string) => string) {
  if (target) {
    if (/^https?:\/\//i.test(target)) return target;
    return localePath(target.startsWith('/') ? target : `/${target}`);
  }

  if (typeof window === 'undefined') return localePath('/');
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
