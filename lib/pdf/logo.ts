import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fetched server-side and inlined as a data URI — @react-pdf/renderer's
 * <Image> can take a URL, but a signed one would need minting per render and
 * expires, which is the wrong lifetime for something baked into a PDF's
 * bytes. A data URI has no such lifetime: whatever renders today is exactly
 * what's in the bytes today, same as everything else on the page.
 */
export async function loadOrgLogoDataUri(
  supabase: SupabaseClient,
  logoPath: string | null,
): Promise<string | null> {
  if (!logoPath) return null;

  const { data, error } = await supabase.storage.from("org-logos").download(logoPath);
  if (error || !data) return null;

  const ext = logoPath.slice(logoPath.lastIndexOf(".") + 1).toLowerCase();
  const mime =
    ext === "png" ? "image/png"
    : ext === "webp" ? "image/webp"
    : ext === "svg" ? "image/svg+xml"
    : "image/jpeg";

  // react-pdf's <Image> cannot rasterise SVG — only bitmap formats.
  if (mime === "image/svg+xml") return null;

  const bytes = Buffer.from(await data.arrayBuffer());
  return `data:${mime};base64,${bytes.toString("base64")}`;
}
