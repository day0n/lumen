import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isProtectedRoute = createRouteMatcher(['/agent-chat(.*)', '/canvas(.*)', '/materials(.*)']);

export default clerkMiddleware(
  async (auth, request) => {
    if (isProtectedRoute(request)) {
      const { userId } = await auth();
      if (!userId) {
        const signUpUrl = new URL('/sign-up', request.url);
        signUpUrl.searchParams.set(
          'redirect_url',
          `${request.nextUrl.pathname}${request.nextUrl.search}`,
        );
        return NextResponse.redirect(signUpUrl);
      }
    }
  },
  {
    signInUrl: '/sign-in',
    signUpUrl: '/sign-up',
  },
);

export const config = {
  matcher: [
    '/((?!_next|ws/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/__clerk/(.*)',
    '/(api|trpc)(.*)',
  ],
};
