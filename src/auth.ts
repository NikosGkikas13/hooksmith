import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import { PrismaAdapter } from "@auth/prisma-adapter";

import authConfig from "./auth.config";
import { prisma } from "./lib/prisma";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: PrismaAdapter(prisma as any),
  providers: [
    Nodemailer({
      // When no SMTP credentials are set (e.g. local MailHog) use a plain URL string.
      // A string value is not deep-merged by @auth/core, so the provider default
      // auth: { user: "", pass: "" } doesn't survive and nodemailer skips PLAIN auth.
      server: process.env.EMAIL_SERVER_USER
        ? {
            host: process.env.EMAIL_SERVER_HOST,
            port: Number(process.env.EMAIL_SERVER_PORT ?? 1025),
            auth: {
              user: process.env.EMAIL_SERVER_USER,
              pass: process.env.EMAIL_SERVER_PASSWORD,
            },
          }
        : `smtp://${process.env.EMAIL_SERVER_HOST}:${process.env.EMAIL_SERVER_PORT ?? 1025}`,
      from: process.env.EMAIL_FROM,
    }),
  ],
});
