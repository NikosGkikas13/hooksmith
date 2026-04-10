import NextAuth from "next-auth";
import authConfig from "./auth.config";

const { auth } = NextAuth(authConfig);

// Next.js 16 renamed `middleware.ts` → `proxy.ts`. NextAuth's edge-safe
// `auth` export doubles as the proxy handler: it reads the session cookie,
// runs the `authorized` callback from auth.config, and redirects to /signin.
export default auth;

export const config = {
  matcher: [
    "/sources/:path*",
    "/events/:path*",
    "/destinations/:path*",
    "/routes/:path*",
    "/settings/:path*",
  ],
};
