import type { NextAuthConfig } from "next-auth";

// Edge-safe config shared between full auth.ts (with Prisma adapter)
// and middleware.ts (no adapter, cookie-only check).
export default {
  providers: [],
  pages: {
    signIn: "/signin",
  },
  session: { strategy: "jwt" },
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
