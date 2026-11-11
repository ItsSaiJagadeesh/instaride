import { fetch } from "expo/fetch";
import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { DEMO_MODE, demoRequest } from "@/lib/demo";

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

/**
 * Base URL of the Express API server.
 * EXPO_PUBLIC_DOMAIN is a host such as "api.example.com" (https) or "192.168.1.20:5000" /
 * "localhost:5000" for local testing (plain http, local networks only).
 */
export function getApiUrl(): string {
  const host = process.env.EXPO_PUBLIC_DOMAIN || (DEMO_MODE ? "demo.invalid" : undefined);
  if (!host) {
    throw new Error("EXPO_PUBLIC_DOMAIN is not set");
  }
  const isLocal =
    /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(host);
  return new URL(`${isLocal ? "http" : "https"}://${host}`).href;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return authToken ? { ...extra, Authorization: `Bearer ${authToken}` } : extra;
}

async function throwIfResNotOk(res: Response) {
  if (res.ok) return;
  if (res.status === 401 && authToken) onUnauthorized?.();
  const text = (await res.text()) || res.statusText;
  let message = text;
  try {
    const parsed = JSON.parse(text);
    if (parsed?.message) message = String(parsed.message);
  } catch {}
  throw new Error(message);
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  // Demo mode: answer from sample data, never from a server.
  if (DEMO_MODE) return demoRequest(method, route, data, authToken);

  const url = new URL(route, getApiUrl());

  const res = await fetch(url.toString(), {
    method,
    headers: authHeaders(data ? { "Content-Type": "application/json" } : {}),
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = new URL(queryKey.join("/") as string, getApiUrl());

    const res = await fetch(url.toString(), { headers: authHeaders() });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
