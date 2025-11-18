import { useEffect, useState } from "react";
import { fetchProjectModels } from "../core/projects-api";

export function useProjectModels(
  projectPath: string | null | undefined,
  pollIntervalMs = 5000
) {
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let inFlight = false;
    let first = true;

    if (!projectPath) {
      setModels([]);
      setError(null);
      setLoading(false);
      return () => {
        cancelled = true;
        if (intervalId) clearInterval(intervalId);
      };
    }

    setModels([]);
    setLoading(true);

    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const list = await fetchProjectModels(projectPath);
        if (cancelled) return;
        setModels(list);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        inFlight = false;
        if (!cancelled && first) {
          setLoading(false);
          first = false;
        }
      }
    };

    void load();
    intervalId = setInterval(() => {
      void load();
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [pollIntervalMs, projectPath]);

  return { models, loading, error };
}
