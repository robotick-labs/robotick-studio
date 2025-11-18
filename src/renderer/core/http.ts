export async function fetchJSON<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Request failed ${response.status} ${response.statusText}: ${text}`
    );
  }
  return (await response.json()) as T;
}

export async function tryFetchJSON<T>(
  url: string,
  init?: RequestInit
): Promise<T | null> {
  try {
    return await fetchJSON<T>(url, init);
  } catch {
    return null;
  }
}

export function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | undefined>
): string {
  const url = new URL(path, ensureTrailingSlash(baseUrl));
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export function buildWebSocketUrl(baseUrl: string, path: string): string {
  const url = new URL(path, ensureTrailingSlash(baseUrl));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function ensureTrailingSlash(url: string) {
  return url.endsWith("/") ? url : `${url}/`;
}
