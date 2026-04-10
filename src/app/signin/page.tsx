import { signIn } from "@/auth";

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-xl font-semibold tracking-tight">
          Sign in to HookSmith
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          We&apos;ll email you a magic link — no password required.
        </p>
        <SignInForm searchParams={searchParams} />
        <p className="mt-6 text-xs text-zinc-500">
          Local dev: check MailHog at{" "}
          <a
            href="http://localhost:8025"
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            localhost:8025
          </a>{" "}
          for the magic link.
        </p>
      </div>
    </main>
  );
}

async function SignInForm({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;
  return (
    <form
      action={async (formData: FormData) => {
        "use server";
        await signIn("nodemailer", {
          email: String(formData.get("email")),
          redirectTo: callbackUrl ?? "/sources",
        });
      }}
      className="mt-6 space-y-3"
    >
      <input
        name="email"
        type="email"
        required
        placeholder="you@example.com"
        className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
      />
      <button
        type="submit"
        className="inline-flex h-10 w-full items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        Send magic link
      </button>
      {error && (
        <p className="text-xs text-red-600">Sign-in error: {error}</p>
      )}
    </form>
  );
}
