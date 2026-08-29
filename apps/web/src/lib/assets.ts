export function staticAssetUrl(path: string): string {
  const relativePath = path.replace(/^\/+/, "");
  const base = import.meta.env.BASE_URL || "./";
  return `${base}${relativePath}`;
}
