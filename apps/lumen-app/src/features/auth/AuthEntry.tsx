import { ClerkProvider, SignIn, SignUp } from '@clerk/react';
import { type ComponentProps, type ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthMark } from './AuthMark';
import { ClerkAuthBoundary } from './ClerkAuthBoundary';
import { AUTH_COPY, type AuthLocale } from './auth-copy';
import { parseAuthPathname, prepareAuthRedirect } from './auth-route';

type ClerkLocalization = ComponentProps<typeof ClerkProvider>['localization'];

export function mountAuth(locale: AuthLocale, localization?: ClerkLocalization) {
  const root = document.getElementById('root');
  if (!root) throw new Error('Root element #root was not found');

  const route = parseAuthPathname(window.location.pathname);
  const copy = AUTH_COPY[locale];
  const currentUrl = new URL(window.location.href);
  const redirect = prepareAuthRedirect(currentUrl, route?.mode);
  if (redirect.changed) window.history.replaceState(null, '', redirect.cleanedUrl);
  persistAuthLocale(locale);
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  document.title = route?.mode === 'sign-up' ? copy.signUpTitle : copy.signInTitle;

  createRoot(root).render(
    <StrictMode>
      <AuthApp locale={locale} localization={localization} redirectUrl={redirect.redirectUrl} />
    </StrictMode>,
  );
}

function AuthApp({
  locale,
  localization,
  redirectUrl,
}: {
  locale: AuthLocale;
  localization?: ClerkLocalization;
  redirectUrl: string;
}) {
  const copy = AUTH_COPY[locale];
  const route = parseAuthPathname(window.location.pathname);
  const homePath = locale === 'zh' ? '/zh' : '/';

  if (!route || route.locale !== locale) {
    return <AuthFrame homePath={homePath}>{copy.invalidRoute}</AuthFrame>;
  }
  if (!__LUMEN_CLERK_PUBLISHABLE_KEY__) {
    return <AuthFrame homePath={homePath}>{copy.missingKey}</AuthFrame>;
  }

  return (
    <ClerkProvider
      publishableKey={__LUMEN_CLERK_PUBLISHABLE_KEY__}
      localization={localization}
      signInUrl={route.signInPath}
      signUpUrl={route.signUpPath}
      afterSignOutUrl={homePath}
      signInFallbackRedirectUrl={redirectUrl}
      signUpFallbackRedirectUrl={redirectUrl}
    >
      <AuthFrame homePath={homePath}>
        <ClerkAuthBoundary backPath={homePath} copy={copy}>
          {route.mode === 'sign-in' ? (
            <SignIn
              routing="path"
              path={route.signInPath}
              signUpUrl={route.signUpPath}
              fallbackRedirectUrl={redirectUrl}
              forceRedirectUrl={redirectUrl}
              signUpFallbackRedirectUrl={redirectUrl}
              signUpForceRedirectUrl={redirectUrl}
            />
          ) : (
            <SignUp
              routing="path"
              path={route.signUpPath}
              signInUrl={route.signInPath}
              fallbackRedirectUrl={redirectUrl}
              forceRedirectUrl={redirectUrl}
              signInFallbackRedirectUrl={redirectUrl}
              signInForceRedirectUrl={redirectUrl}
            />
          )}
        </ClerkAuthBoundary>
      </AuthFrame>
    </ClerkProvider>
  );
}

function AuthFrame({ children, homePath }: { children: ReactNode; homePath: string }) {
  const status = typeof children === 'string';
  return (
    <main className="auth-page">
      <div className="auth-backdrop" aria-hidden>
        <span className="auth-light" />
        <span className="auth-grid" />
        <span className="auth-vignette" />
      </div>
      <div className="auth-content">
        <a className="auth-brand" href={homePath} aria-label="Lumen">
          <AuthMark />
          <span>Lumen</span>
        </a>
        <div className="auth-card-wrap">
          {status ? <p className="auth-status">{children}</p> : children}
        </div>
      </div>
    </main>
  );
}

function persistAuthLocale(locale: AuthLocale) {
  document.cookie = `lumen_locale=${locale}; path=/; max-age=31536000; sameSite=lax`;
  try {
    window.localStorage.setItem('lumen_locale', locale);
  } catch {}
}
