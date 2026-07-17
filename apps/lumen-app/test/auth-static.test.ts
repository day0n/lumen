import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isAuthServiceFailure } from '../src/features/auth/ClerkAuthBoundary';
import {
  normalizeSameOriginRedirect,
  parseAuthPathname,
  prepareAuthRedirect,
} from '../src/features/auth/auth-route';

test('auth routes preserve locale, mode, and path-based subroutes', () => {
  assert.deepEqual(parseAuthPathname('/sign-in'), {
    locale: 'en',
    mode: 'sign-in',
    path: '/sign-in',
    signInPath: '/sign-in',
    signUpPath: '/sign-up',
  });
  assert.deepEqual(parseAuthPathname('/sign-up/verify-email-address'), {
    locale: 'en',
    mode: 'sign-up',
    path: '/sign-up',
    signInPath: '/sign-in',
    signUpPath: '/sign-up',
  });
  assert.deepEqual(parseAuthPathname('/zh/sign-in/factor-one'), {
    locale: 'zh',
    mode: 'sign-in',
    path: '/zh/sign-in',
    signInPath: '/zh/sign-in',
    signUpPath: '/zh/sign-up',
  });

  for (const pathname of ['/sign-inning', '/zh/sign-upstream', '/en/sign-in', '/api/sign-in']) {
    assert.equal(parseAuthPathname(pathname), null, pathname);
  }
});

test('auth redirects keep same-origin destinations and remove redirect controls from the URL', () => {
  const current = new URL(
    'https://lumenstudio.tech/sign-in?ticket=abc&redirect_url=%2Fapp%2Fcanvas%2Fnew%3Fagent%3Dchat%23node&sign_up_force_redirect_url=https%3A%2F%2Fevil.example%2Fsteal#flow',
  );
  const result = prepareAuthRedirect(current, 'sign-in');

  assert.equal(result.redirectUrl, '/app/canvas/new?agent=chat#node');
  assert.equal(result.cleanedUrl, '/sign-in?ticket=abc#flow');
  assert.equal(result.changed, true);
});

test('auth redirect priority follows the active sign-in or sign-up flow', () => {
  const signIn = prepareAuthRedirect(
    new URL(
      'https://lumenstudio.tech/sign-in?redirect_url=%2Fapp%2Fhome&sign_in_force_redirect_url=%2Fapp%2Fprojects',
    ),
    'sign-in',
  );
  const signUp = prepareAuthRedirect(
    new URL(
      'https://lumenstudio.tech/sign-up?redirect_url=%2Fapp%2Fhome&sign_up_force_redirect_url=%2Fapp%2Fmaterials',
    ),
    'sign-up',
  );

  assert.equal(signIn.redirectUrl, '/app/projects');
  assert.equal(signUp.redirectUrl, '/app/materials');
});

test('auth redirects skip unsafe higher-priority values and constrain the fallback', () => {
  const safeLowerPriority = prepareAuthRedirect(
    new URL(
      'https://lumenstudio.tech/sign-in?sign_in_force_redirect_url=https%3A%2F%2Fevil.example%2Fsteal&redirect_url=%2Fapp%2Fprojects',
    ),
    'sign-in',
  );
  const unsafeFallback = prepareAuthRedirect(
    new URL('https://lumenstudio.tech/sign-in'),
    'sign-in',
    'https://evil.example/steal',
  );

  assert.equal(safeLowerPriority.redirectUrl, '/app/projects');
  assert.equal(unsafeFallback.redirectUrl, '/app/home');
});

test('auth redirects reject cross-origin, executable, credentialed, and recursive targets', () => {
  const origin = 'https://lumenstudio.tech';
  for (const value of [
    '//evil.example/steal',
    'https://evil.example/steal',
    'javascript:alert(1)',
    'https://user:pass@lumenstudio.tech/app/home',
    '/sign-in/factor-one',
    '/zh/sign-up/verify',
  ]) {
    assert.equal(normalizeSameOriginRedirect(value, origin), null, value);
  }
  assert.equal(
    normalizeSameOriginRedirect('https://lumenstudio.tech/app/home?tab=recent#item', origin),
    '/app/home?tab=recent#item',
  );
});

test('auth documents provide localized static loading shells without indexing', async () => {
  for (const definition of [
    { filename: 'auth.html', lang: 'en', marker: 'en', text: 'Loading sign-in…' },
    { filename: 'auth-zh.html', lang: 'zh-CN', marker: 'zh', text: '正在加载登录组件…' },
  ]) {
    const html = await readFile(new URL(`../${definition.filename}`, import.meta.url), 'utf8');
    assert.match(html, new RegExp(`<html lang="${definition.lang}">`));
    assert.match(html, new RegExp(`data-lumen-static-auth="${definition.marker}"`));
    assert.ok(html.includes(definition.text));
    assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
    assert.match(html, /class="auth-loading"/);
  }
});

test('the static share entry uses the app-owned lightweight auth boundary', async () => {
  const source = await readFile(
    new URL('../src/features/share/ShareEntry.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /from '\.\.\/auth\/ClerkAuthShell'/);
  assert.doesNotMatch(source, /@\/components\/auth|lumen-studio|@sentry/);
});

test('auth network fallback recognizes only related runtime failures', () => {
  assert.equal(isAuthServiceFailure(new Error('ClerkJS failed to load')), true);
  assert.equal(isAuthServiceFailure('request to clerk.lumenstudio.tech failed'), true);
  assert.equal(isAuthServiceFailure(new Error('unrelated application failure')), false);
});
