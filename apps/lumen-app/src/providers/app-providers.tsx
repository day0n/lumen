import { I18nProvider } from '@/i18n/provider';
import { ClerkProvider, useAuth } from '@clerk/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Provider as JotaiProvider } from 'jotai';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { installApiFetchInterceptor, setApiTokenGetter } from '../lib/api-client';
import { createQueryClient } from '../lib/query-client';
import { MinimalProviders } from './minimal-providers';

function ApiTokenBridge() {
  const { getToken } = useAuth();

  useEffect(() => {
    setApiTokenGetter(() => getToken());
    installApiFetchInterceptor();
    return () => setApiTokenGetter(null);
  }, [getToken]);

  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());
  const publishableKey = useMemo(() => __LUMEN_CLERK_PUBLISHABLE_KEY__, []);

  if (!publishableKey) {
    return (
      <MinimalProviders>
        <div className="flex min-h-dvh items-center justify-center px-6 text-center text-sm text-white/70">
          Missing Clerk publishable key.
        </div>
      </MinimalProviders>
    );
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      afterSignOutUrl="/"
      signInFallbackRedirectUrl="/app/dashboard"
      signUpFallbackRedirectUrl="/app/dashboard"
    >
      <MinimalProviders>
        <JotaiProvider>
          <QueryClientProvider client={queryClient}>
            <I18nProvider>
              <ApiTokenBridge />
              {children}
            </I18nProvider>
          </QueryClientProvider>
        </JotaiProvider>
      </MinimalProviders>
    </ClerkProvider>
  );
}
