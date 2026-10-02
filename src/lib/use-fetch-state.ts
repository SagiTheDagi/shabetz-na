"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { fetchJson } from "@/lib/fetch-json";

/** GETs `url` on mount and exposes the JSON. `setData` allows local updates (e.g. after a POST). */
export function useFetchState<T>(url: string): {
  data: T | null;
  setData: Dispatch<SetStateAction<T | null>>;
  loading: boolean;
  error: boolean;
  refetch: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Only the latest request may write state (guards url change / unmount races).
  const latest = useRef(0);

  const refetch = useCallback(async () => {
    const id = ++latest.current;
    setLoading(true);
    const result = await fetchJson<T>(url);
    if (id !== latest.current) return;
    if (result.ok) {
      setData(result.data);
      setError(false);
    } else {
      setError(true);
    }
    setLoading(false);
  }, [url]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refetch();
    const ref = latest;
    return () => {
      ref.current++;
    };
  }, [refetch]);

  return { data, setData, loading, error, refetch };
}
