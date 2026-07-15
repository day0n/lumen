export type AuthLocale = 'en' | 'zh';

export interface AuthBoundaryCopy {
  backHome: string;
  loading: string;
  networkHint: string;
  retry: string;
  timeoutTitle: string;
  tips: readonly string[];
}

export interface AuthCopy extends AuthBoundaryCopy {
  invalidRoute: string;
  missingKey: string;
  signInTitle: string;
  signUpTitle: string;
}

export const AUTH_COPY: Record<AuthLocale, AuthCopy> = {
  en: {
    backHome: 'Back to home',
    invalidRoute: 'This account page is unavailable.',
    loading: 'Loading sign-in…',
    missingKey: 'Authentication is temporarily unavailable.',
    networkHint:
      'We could not reach the authentication service. A VPN, proxy, or DNS rule may be blocking it.',
    retry: 'Reload page',
    signInTitle: 'Sign in — Lumen',
    signUpTitle: 'Create account — Lumen',
    timeoutTitle: 'Sign-in is taking longer than expected',
    tips: [
      'Try turning off your VPN or proxy and reload the page.',
      'If you must use a proxy, route the authentication service the same way as the main site.',
      'Use private browsing or another browser to rule out cached state.',
    ],
  },
  zh: {
    backHome: '回到首页',
    invalidRoute: '当前账户页面不可用。',
    loading: '正在加载登录组件…',
    missingKey: '鉴权服务暂时不可用。',
    networkHint: '当前无法连接鉴权服务，可能被 VPN、代理或 DNS 规则拦截。',
    retry: '重新加载',
    signInTitle: '登录 — Lumen',
    signUpTitle: '创建账户 — Lumen',
    timeoutTitle: '登录加载得有点慢',
    tips: [
      '先关闭 VPN 或代理，然后刷新页面重试。',
      '如果必须使用代理，请让鉴权服务与主站使用相同的路由规则。',
      '可以使用无痕模式或更换浏览器，排除本地缓存问题。',
    ],
  },
};
