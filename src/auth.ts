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
      server: {
        host: process.env.EMAIL_SERVER_HOST,
        port: Number(process.env.EMAIL_SERVER_PORT ?? 1025),
        auth: process.env.EMAIL_SERVER_USER
          ? {
              user: process.env.EMAIL_SERVER_USER,
              pass: process.env.EMAIL_SERVER_PASSWORD,
            }
          : undefined,
      },
      from: process.env.EMAIL_FROM,
    }),
  ],
});
