import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const TOKEN_KEY = "uptime_session_token";

type AuthState = {
  loading: boolean;
  initialized: boolean;
  authenticated: boolean;
  username: string | null;
  publicStatusPage: boolean;
};

type AuthContextValue = AuthState & {
  refresh: () => Promise<void>;
  setup: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changeCredentials: (input: { current_password: string; new_username?: string; new_password?: string }) => Promise<void>;
  updateSettings: (input: { public_status_page: boolean }) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

async function call(action: string, body: Record<string, unknown> = {}) {
  const token = getToken();
  const { data, error } = await supabase.functions.invoke("auth", {
    body: { action, ...body },
    headers: token ? { "x-session-token": token } : undefined,
  });
  if (error) {
    // Try to parse server error message
    const ctx = (error as { context?: Response }).context;
    if (ctx) {
      try {
        const j = await ctx.json();
        throw new Error(j.error || error.message);
      } catch (e) {
        if (e instanceof Error && e.message) throw e;
      }
    }
    throw error;
  }
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    loading: true,
    initialized: false,
    authenticated: false,
    username: null,
  });

  const refresh = useCallback(async () => {
    try {
      const data = await call("status");
      setState({
        loading: false,
        initialized: !!data.initialized,
        authenticated: !!data.authenticated,
        username: data.username ?? null,
      });
    } catch {
      setState({ loading: false, initialized: false, authenticated: false, username: null });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const setup = async (username: string, password: string) => {
    const data = await call("setup", { username, password });
    if (data?.token) localStorage.setItem(TOKEN_KEY, data.token);
    await refresh();
  };

  const login = async (username: string, password: string) => {
    const data = await call("login", { username, password });
    if (data?.token) localStorage.setItem(TOKEN_KEY, data.token);
    await refresh();
  };

  const logout = async () => {
    try { await call("logout"); } catch { /* ignore */ }
    localStorage.removeItem(TOKEN_KEY);
    await refresh();
  };

  const changeCredentials: AuthContextValue["changeCredentials"] = async (input) => {
    await call("change-credentials", input);
    if (input.new_password) {
      // session may be invalidated; force re-login
      localStorage.removeItem(TOKEN_KEY);
    }
    await refresh();
  };

  return (
    <AuthContext.Provider value={{ ...state, refresh, setup, login, logout, changeCredentials }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
