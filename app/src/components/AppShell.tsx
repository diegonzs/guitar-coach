import { Link, useLocation } from "wouter";
import { BookOpen, Gauge, Home, LineChart, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Hoy", icon: Home },
  { href: "/lecciones", label: "Lecciones", icon: BookOpen },
  { href: "/afinador", label: "Afinador", icon: Gauge },
  { href: "/progreso", label: "Progreso", icon: LineChart },
  { href: "/ajustes", label: "Ajustes", icon: Settings },
];

function active(loc: string, href: string) {
  return href === "/" ? loc === "/" : loc.startsWith(href);
}

/** Bottom tab bar on phones, side rail on wide screens. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [loc] = useLocation();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[76px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col items-center gap-1.5 border-r py-4 lg:flex">
        <Link href="/" className="mb-4 grid size-10 place-items-center rounded-xl bg-primary font-serif text-2xl text-primary-foreground" aria-label="Inicio">
          g
        </Link>
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn("flex w-16 flex-col items-center gap-1 rounded-xl py-2 text-[10.5px] font-medium text-muted-foreground transition-colors hover:text-foreground", active(loc, href) && "bg-secondary text-foreground")}
          >
            <Icon className="size-5" />
            {label}
          </Link>
        ))}
      </aside>
      <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-safe lg:max-w-5xl lg:px-8 lg:pb-10">{children}</div>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background/95 px-2 pt-2 pb-safe backdrop-blur lg:hidden">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={cn("flex flex-col items-center gap-1 text-[10.5px] font-medium text-muted-foreground", active(loc, href) && "text-primary")}>
            <Icon className="size-[22px]" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
