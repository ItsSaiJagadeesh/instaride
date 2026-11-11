/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). Small helper for loading data from the API. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/lib/query-client';

export function useApiGet<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest('GET', path);
      const json = (await res.json()) as T;
      if (alive.current) setData(json);
    } catch (e: any) {
      if (alive.current) setError(e?.message || 'Could not load');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => { void reload(); }, [reload]);

  return { data, loading, error, reload };
}
