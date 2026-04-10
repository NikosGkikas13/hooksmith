import Link from "next/link";

import { auth, signOut } from "@/auth";

const NAV = [
  { href: "/sources", label: "Sources" },
  { href: "/events", label: "Events" },
  { href: "/destinations", label: "Destinations" },
  { href: "/routes", label: "Routes" },
  { href: "/settings/api-keys", label: "Settings" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-6">
          <Link
            href="/sources"
            className="font-mono text-sm font-semibold tracking-tight"
          >
            hooksmith
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-zinc-500">
            <span>{session?.user?.email}</span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        {children}
      </main>
    </div>
  );
}
