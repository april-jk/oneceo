import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  type AppAuthUser,
  loginAppUser,
  logoutAppUser,
  registerAppUser,
  resolveAppAuthSession,
  startAppAuthOAuth,
  sendRegisterVerificationCode,
  type AppUserPersonalization,
  updateAppUserProfile,
} from "@/lib/auth-client";

type AuthStatus = "loading" | "authenticated" | "anonymous";

export type UserCredits = {
  balance: number;
  totalEarned: number;
  totalConsumed: number;
};

type AuthContextValue = {
  user: AppAuthUser | null;
  status: AuthStatus;
  credits: UserCredits | null;
  refreshCredits: () => Promise<void>;
  login: (input: { email: string; password: string }) => Promise<AppAuthUser>;
  startOAuth: (input: { provider: "google" | "github"; redirect?: string }) => Promise<void>;
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
  const [credits, setCredits] = useState<UserCredits | null>(null);

  const refreshCredits = useCallback(async () => {
    try {
      const response = await fetch('/api/billing/credits', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setCredits(data);
      }
    } catch (error) {
      console.error('获取积分余额失败:', error);
    }
  }, []);

  const refresh = async () => {
    try {
      const currentUser = await resolveAppAuthSession();
      setUser(currentUser);
      setStatus(currentUser ? "authenticated" : "anonymous");
      if (currentUser) {
        await refreshCredits();
      }
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
    credits,
    refreshCredits,
    login: async (input) => {
      setStatus("loading");
      const nextUser = await loginAppUser(input);
      setUser(nextUser);
      setStatus("authenticated");
      await refreshCredits();
      return nextUser;
    },
    startOAuth: async (input) => {
      const result = await startAppAuthOAuth(input);
      window.location.assign(result.authUrl);
    },
    sendRegisterCode: async (input) => await sendRegisterVerificationCode(input),
    register: async (input) => {
      setStatus("loading");
      const nextUser = await registerAppUser(input);
      setUser(nextUser);
      setStatus("authenticated");
      await refreshCredits();
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
      setCredits(null);
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
