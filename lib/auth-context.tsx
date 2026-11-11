import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import { apiRequest, setAuthToken, setUnauthorizedHandler } from '@/lib/query-client';
import { loadToken, saveToken, clearToken } from '@/lib/token-store';
import type { User, SignupInput } from '@shared/schema';

type VerifyResult = { user: User } | { needsSignup: true; signupToken: string };

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  /** Sends a 6-digit code to the phone number. */
  requestOtp: (phone: string) => Promise<{ resendAfterSeconds: number }>;
  /** Checks the code. Signs in if the account exists, otherwise returns a token to finish signing up. */
  verifyOtp: (phone: string, otp: string, role: 'rider' | 'driver') => Promise<VerifyResult>;
  /** Creates the account after a verified phone number. */
  signup: (signupToken: string, details: Pick<SignupInput, 'fullName' | 'vehicle'>) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const logout = useCallback(async () => {
    // Clear the signed-in state first, in the same moment, so a screen that opens right after
    // (the welcome screen) never still sees the old user and sends them back in.
    setAuthToken(null);
    setUser(null);
    await clearToken();
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void logout();
    });
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  useEffect(() => {
    (async () => {
      try {
        const token = await loadToken();
        if (token) {
          setAuthToken(token);
          const res = await apiRequest('GET', '/api/me');
          const fresh = await res.json();
          if (fresh?.id) setUser(fresh);
          else await logout();
        }
      } catch {
        await logout();
      } finally {
        setIsLoading(false);
      }
    })();
  }, [logout]);

  const startSession = async (body: { token: string; user: User }): Promise<User> => {
    await saveToken(body.token);
    setAuthToken(body.token);
    setUser(body.user);
    return body.user;
  };

  const requestOtp = async (phone: string) => {
    const res = await apiRequest('POST', '/api/auth/otp/request', { phone });
    return res.json();
  };

  const verifyOtp = async (phone: string, otp: string, role: 'rider' | 'driver'): Promise<VerifyResult> => {
    const res = await apiRequest('POST', '/api/auth/otp/verify', { phone, otp, role });
    const body = await res.json();
    if (body.needsSignup) return { needsSignup: true, signupToken: body.signupToken };
    return { user: await startSession(body) };
  };

  const signup = async (signupToken: string, details: Pick<SignupInput, 'fullName' | 'vehicle'>) => {
    const res = await apiRequest('POST', '/api/auth/signup', { signupToken, ...details });
    return startSession(await res.json());
  };

  const refreshUser = async () => {
    try {
      const res = await apiRequest('GET', '/api/me');
      setUser(await res.json());
    } catch {}
  };

  const value = useMemo(
    () => ({ user, isLoading, requestOtp, verifyOtp, signup, logout, refreshUser }),
    [user, isLoading, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
