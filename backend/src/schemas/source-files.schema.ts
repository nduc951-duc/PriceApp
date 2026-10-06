import { z } from "zod";

export const signedUrlBody = z.strictObject({ storagePath: z.string().min(1).max(1024) });

export function parseObjectPath(input: unknown): string | null {
  const parsed = signedUrlBody.safeParse(input);
  if (!parsed.success) return null;
  const path = parsed.data.storagePath.replace(/^source-pages\//, "");
  if (!path || path.trim() !== path || path.includes("\\") || /[?#%]/.test(path) ||
      [...path].some(char => char.charCodeAt(0) < 32) ||
      path.startsWith("/") || path.includes(":") || path.split("/").some(part => !part || part === "." || part === "..")) return null;
  return path;
}
