import Link from "next/link";

type NavItem = { href: string; label: string };

export function GymShell({
  title,
  nav,
  children,
  mainClassName = "",
}: {
  title: string;
  nav: NavItem[];
  children: React.ReactNode;
  mainClassName?: string;
}) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">ABODY Gym OS</p>
            <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          </div>
          <nav className="flex flex-wrap gap-2 text-sm">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:bg-slate-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className={`mx-auto max-w-3xl px-4 py-6 ${mainClassName}`}>{children}</main>
    </div>
  );
}

