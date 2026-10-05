"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Submenú de configuración: lista lateral en escritorio, pestañas con scroll en móvil. */
export function ConfigNav({ sections }: { sections: { slug: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Configuración" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:w-56 lg:shrink-0 lg:px-0">
      <ul className="flex gap-1 lg:flex-col">
        {sections.map((s) => {
          const href = `/configuracion/${s.slug}`;
          const active = pathname === href;
          return (
            <li key={s.slug} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={[
                  "block rounded-lg px-3 py-2 text-sm whitespace-nowrap transition",
                  active
                    ? "bg-brand-100 font-medium text-brand-900"
                    : "text-ink-muted hover:bg-surface hover:text-ink",
                ].join(" ")}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
