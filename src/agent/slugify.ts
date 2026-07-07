/** Turns an identified project name into a URL/DB-safe slug, e.g. "My Project!" -> "my-project". */
export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "project";
}
