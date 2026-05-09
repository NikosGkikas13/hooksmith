// Shared Nodemailer transport for transactional and scheduled-job email.
// Reuses the same EMAIL_SERVER_* / EMAIL_FROM env vars that the auth
// magic-link flow ([src/auth.ts](src/auth.ts)) already loads, so a
// production deployment configures one SMTP relay and both flows pick
// it up.
//
// Usage:
//   import { sendMail } from "@/lib/mailer";
//   await sendMail({ to, subject, text, html? });

import nodemailer, { type Transporter } from "nodemailer";

let _transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (_transporter) return _transporter;

  const host = process.env.EMAIL_SERVER_HOST;
  const port = Number(process.env.EMAIL_SERVER_PORT ?? 1025);
  const user = process.env.EMAIL_SERVER_USER;
  const pass = process.env.EMAIL_SERVER_PASSWORD;

  if (!host) {
    throw new Error(
      "EMAIL_SERVER_HOST is not set — cannot send mail. See DEPLOY.md §2.",
    );
  }

  // Mirror the auth.ts shape: a plain URL when no credentials are set
  // (local MailHog), structured config otherwise. Passing a structured
  // object with empty auth makes Nodemailer attempt PLAIN against
  // MailHog and fail.
  _transporter = user
    ? nodemailer.createTransport({
        host,
        port,
        auth: { user, pass: pass ?? "" },
      })
    : nodemailer.createTransport(`smtp://${host}:${port}`);

  return _transporter;
}

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export async function sendMail(msg: MailMessage): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not set — refusing to send mail.");
  }
  const transporter = getTransporter();
  await transporter.sendMail({
    from,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
}
