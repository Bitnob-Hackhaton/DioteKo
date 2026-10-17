import { useSyncExternalStore } from "react";
import { api, tokens } from "./api";
import { can, type Permission } from "./permissions";
import type { Me } from "./types";

type AuthState =
  | { status: "loading" }
  | { status: "anonymous"; reason?: "expired" | "not_staff" | "idle" | undefined }
  | { status: "authenticated"; user: Me };

let state: AuthState = { status: "loading" };
const listeners = new Set<() => void>();
const set = (s: AuthState) => {
  state = s;
  listeners.forEach((l) => l());
};

tokens.onExpired(() => set({ status: "anonymous", reason: "expired" }));

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const SERVER: AuthState = { status: "loading" };

export function useAuth() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER,
  );
}

export function useUser(): Me | null {
  const s = useAuth();
  return s.status === "authenticated" ? s.user : null;
}

export function useCan(permission: Permission): boolean {
  return can(useUser(), permission);
}

const isStaff = (u: Me) => u.roles.length > 0 || !!u.platformRole;

async function loadMe() {
  const user = await api.me();
  if (!isStaff(user)) {
    await api.logout();
    set({ status: "anonymous", reason: "not_staff" });
    return false;
  }
  set({ status: "authenticated", user });
  return true;
}

let booted = false;
export const auth = {
  async boot() {
    if (booted) return;
    booted = true;
    try {
      if (tokens.access || (await api.resume())) {
        await loadMe();
        return;
      }
    } catch {
      /* fall through */
    }
    set({ status: "anonymous" });
  },
  async login(email: string, password: string) {
    await api.login(email, password);
    booted = true;
    return loadMe();
  },
  async impersonate(userId: string) {
    api.impersonate(userId);
    return loadMe();
  },
  async logout(reason?: "idle") {
    await api.logout();
    set({ status: "anonymous", reason });
  },
};
