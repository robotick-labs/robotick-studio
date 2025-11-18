export function urlToId(url: string) {
  return url.replace(/[:/.]/g, "_");
}
