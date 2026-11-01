import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { SafeUser } from "@ai-review/core";
import {
  checkAuthStatus,
  setupFirstAdmin,
  login as apiLogin,
  logout as apiLogout,
  fetchCurrentUser,
  getStoredToken,
  setStoredToken,
} from "./api.js";

interface AuthContextValue {
  user: SafeUser | null;
  token: string | null;
  isLoading: boolean;
  isFirstRun: boolean;
  login: (loginStr: string, passStr: string) => Promise<void>;
  setupAdmin: (params: {
    name: string;
    email: string;
    password: string;
    passwordConfirmation: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [isLoading, setIsLoading] = useState(true);
  const [isFirstRun, setIsFirstRun] = useState(false);

  const initAuth = useCallback(async () => {
    try {
      setIsLoading(true);
      const status = await checkAuthStatus();
      setIsFirstRun(!status.initialized);

      if (status.authenticated && status.user) {
        setUser(status.user);
      } else if (getStoredToken()) {
        try {
          const me = await fetchCurrentUser();
          setUser(me);
        } catch {
          setStoredToken(null);
          setToken(null);
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch (err) {
      console.warn("Auth initialization notice:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    initAuth();

    const handleUnauthorized = () => {
      setStoredToken(null);
      setToken(null);
      setUser(null);
    };

    window.addEventListener("ai-review-auth-unauthorized", handleUnauthorized);
    return () => {
      window.removeEventListener("ai-review-auth-unauthorized", handleUnauthorized);
    };
  }, [initAuth]);

  const login = async (loginStr: string, passStr: string) => {
    const res = await apiLogin(loginStr, passStr);
    setUser(res.user);
    setToken(res.token);
    setIsFirstRun(false);
  };

  const setupAdmin = async (params: {
    name: string;
    email: string;
    password: string;
    passwordConfirmation: string;
  }) => {
    const res = await setupFirstAdmin(params);
    setUser(res.user);
    setToken(res.token);
    setIsFirstRun(false);
  };

  const logout = async () => {
    try {
      await apiLogout();
    } catch {
      // Ignored
    } finally {
      setUser(null);
      setToken(null);
    }
  };

  const refreshUser = async () => {
    if (!token) return;
    try {
      const me = await fetchCurrentUser();
      setUser(me);
    } catch {
      // Ignored
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isFirstRun,
        login,
        setupAdmin,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
