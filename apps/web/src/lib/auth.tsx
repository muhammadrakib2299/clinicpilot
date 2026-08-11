import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { SessionUser } from "@clinicpilot/shared-types";
import { roleAtLeast, type UserRole } from "@clinicpilot/shared-types/roles";

import * as api from "@/lib/api";
import { getToken, setToken } from "@/lib/session";

interface AuthValue {
  user: SessionUser | null;
  /** True until the stored token has been checked, so nothing flashes. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  /** Hierarchical: `can("coordinator")` is true for a clinician and an admin. */
  can: (minimum: UserRole) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * A stored token is a claim, not a session.
   *
   * It is verified against `/auth/me` on load rather than decoded here: it may
   * have expired, and the user's role or membership may have changed since it
   * was issued. Trusting the payload would show an admin sidebar to someone
   * who was demoted an hour ago — the API would still refuse them, but the UI
   * would be lying.
   */
  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    api
      .fetchMe()
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch(() => {
        if (!cancelled) setToken(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Any 401 anywhere drops the session, so an expired token cannot leave the
  // user on a screen that will never load.
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener(api.SESSION_EXPIRED, onExpired);
    return () => window.removeEventListener(api.SESSION_EXPIRED, onExpired);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { token, user: signedIn } = await api.login(email, password);
    setToken(token);
    setUser(signedIn);
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setToken(null);
    setUser(null);
  }, []);

  const switchTenant = useCallback(async (tenantId: string) => {
    // A new token, because the tenant is a claim inside it — the server will
    // not accept the old one for the new organisation.
    const { token, user: switched } = await api.switchTenant(tenantId);
    setToken(token);
    setUser(switched);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      signIn,
      signOut,
      switchTenant,
      can: (minimum) => (user ? roleAtLeast(user.role, minimum) : false),
    }),
    [user, loading, signIn, signOut, switchTenant],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * eslint-disable-next-line react-refresh/only-export-components
 *
 * The rule wants the hook in its own file so Fast Refresh can hot-swap the
 * provider. Splitting it means a third module holding the context that both
 * import, to avoid a cycle — three files and an indirection to keep a dev-time
 * convenience that costs a full reload when this one file is edited.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside an AuthProvider");
  return value;
}
