import { cookies } from "next/headers";
import { requireSession } from "@/server/auth/guards";
import { ROLE_LABELS } from "@/server/permissions/matrix";
import { mainNavFor, SIDEBAR_COOKIE } from "@/lib/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { FirebaseSessionProvider } from "@/components/providers/firebase-session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";
  return (
    <FirebaseSessionProvider uid={session.uid} orgId={session.orgId}>
      <AppShell
        nav={mainNavFor(session.role, session.overrides)}
        user={{
          displayName: session.member.displayName,
          email: session.email,
          roleLabel: ROLE_LABELS[session.role],
        }}
        org={{ name: session.org.name, isDemo: session.org.isDemo }}
        initialCollapsed={collapsed}
      >
        {children}
      </AppShell>
    </FirebaseSessionProvider>
  );
}
