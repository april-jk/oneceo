import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  type AppAuthUser,
  loginAppUser,
  logoutAppUser,
  registerAppUser,
  resolveAppAuthSession,
  sendRegisterVerificationCode,
  type AppUserPersonalization,
  updateAppUserProfile,
} from "@/lib/auth-client";

type AuthStatus = "loading" | "authenticated" | "anonymous";

type AuthContextValue = {
  user: AppAuthUser | null;
  status: AuthStatus;
  login: (input: { email: string; password: string }) => Promise<AppAuthUser>;
  sendRegisterCode: (input: { email: string }) => Promise<{ cooldownSeconds?: number; expiresInSeconds?: number }>;
  register: (input: {
    email: string;
    password: string;
    displayName: string;
    verificationCode: string;
  }) => Promise<AppAuthUser>;
  updateProfile: (input: {
    displayName?: string;
    personalization?: AppUserPersonalization;
  }) => Promise<AppAuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<AppAuthUser | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppAuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  const refresh = async () => {
    try {
      const currentUser = await resolveAppAuthSession();
      setUser(currentUser);
      setStatus(currentUser ? "authenticated" : "anonymous");
      return currentUser;
    } catch (error) {
      setUser(null);
      setStatus("anonymous");
      throw error;
    }
  };

  useEffect(() => {
    void refresh().catch(() => {
      // ignore bootstrap auth failures and show anonymous state
    });
  }, []);

  const value: AuthContextValue = {
    user,
    status,
    login: async (input) => {
      setStatus("loading");
      const nextUser = await loginAppUser(input);
      setUser(nextUser);
      setStatus("authenticated");
      return nextUser;
    },
    sendRegisterCode: async (input) => await sendRegisterVerificationCode(input),
    register: async (input) => {
      setStatus("loading");
      const nextUser = await registerAppUser(input);
      setUser(nextUser);
      setStatus("authenticated");
      return nextUser;
    },
    updateProfile: async (input) => {
      const nextUser = await updateAppUserProfile(input);
      setUser(nextUser);
      setStatus("authenticated");
      return nextUser;
    },
    logout: async () => {
      await logoutAppUser();
      setUser(null);
      setStatus("anonymous");
    },
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
