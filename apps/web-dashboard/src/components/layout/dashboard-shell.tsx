import type { PropsWithChildren } from "react";
import { Link, useLocation } from "react-router-dom";
import { ShieldCheck, Sparkles } from "lucide-react";

const navItems = [{ label: "Prompts", href: "/" }];

export function DashboardShell({ children }: PropsWithChildren): JSX.Element {
  const location = useLocation();

  return (
    <div className="relative min-h-screen px-4 pb-8 pt-5 sm:px-6 lg:px-10">
      <div className="pointer-events-none absolute left-0 top-0 -z-10 h-56 w-56 rounded-full bg-pg-cyan/25 blur-3xl" />
      <div className="pointer-events-none absolute bottom-8 right-10 -z-10 h-72 w-72 animate-floaty rounded-full bg-pg-coral/20 blur-3xl" />

      <header className="mx-auto mb-6 flex w-full max-w-6xl items-center justify-between rounded-2xl border border-white/60 bg-white/75 px-4 py-3 shadow-panel backdrop-blur sm:px-6">
        <Link to="/" className="flex items-center gap-3">
          <span className="rounded-lg bg-pg-ink p-2 text-white">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-pg-slate/70">PromptGuard</p>
            <p className="text-lg font-semibold text-pg-ink">Semantic Regression Dashboard</p>
          </div>
        </Link>

        <nav className="flex items-center gap-2 text-sm font-medium">
          {navItems.map((item) => {
            const active = location.pathname === item.href;
            return (
              <Link
                key={item.href}
                to={item.href}
                className={`rounded-full px-4 py-2 transition ${
                  active ? "bg-pg-ink text-white" : "text-pg-slate hover:bg-pg-slate/10"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <span className="hidden items-center gap-1 rounded-full bg-pg-coral/15 px-3 py-1 text-xs font-semibold text-pg-ink sm:inline-flex">
            <Sparkles className="h-3.5 w-3.5" />
            Live Trends
          </span>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl animate-rise">{children}</main>
    </div>
  );
}
