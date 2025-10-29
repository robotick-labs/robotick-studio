export function idFor(modelPath: string, id: string): string {
  const base = modelPath.split("/").pop()?.replace(/\.model\.yaml$/, "") ?? "";
  return `${base}:${id}`;
}
