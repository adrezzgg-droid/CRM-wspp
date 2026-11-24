import { cookies } from "next/headers";
import { requireSession } from "@/server/auth/guards";
import { ROLE_LABELS } from "@/server/permissions/matrix";
import { navGroupsFor } from "@/lib/navigation";
import { OWNER_ROLES } from "@/server/org/data";
import { AppShell } from "@/components/shell/app-shell";
import { FirebaseSessionProvider } from "@/components/providers/firebase-session";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <FirebaseSessionProvider uid={session.uid} orgId={session.orgId}>
      <AppShell
        groups={navGroupsFor(session.role, session.overrides)}
        user={{
          displayName: session.member.displayName,
          email: session.email,
          roleLabel: ROLE_LABELS[session.role],
          available: OWNER_ROLES.has(session.role) ? session.member.available : undefined,
        }}
        org={{ name: session.org.name, isDemo: session.org.isDemo }}
        theme={theme}
      >
        {children}
      </AppShell>
    </FirebaseSessionProvider>
  );
}
