import { getCurrentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { UUID_RE } from "@/lib/queries";
import { readUpload, safeFileName } from "@/lib/storage";

/** Streams an uploaded receipt to signed-in users of the same tenant (claimants: own startup only). */
export async function GET(_request: Request, context: RouteContext<"/api/files/[id]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await context.params;
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });

  const claim = await queryOne<{ tenant_id: string; startup_id: string; file_mime: string; file_name: string }>(
    "SELECT tenant_id, startup_id, file_mime, file_name FROM claims WHERE id = $1 AND tenant_id = $2",
    [id, user.tenantId],
  );
  if (!claim || (user.role === "claimant" && claim.startup_id !== user.startupId)) {
    return new Response("Not found", { status: 404 });
  }

  const file = await readUpload(claim.tenant_id, id, claim.file_mime);
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": claim.file_mime === "text/plain" ? "text/plain; charset=utf-8" : claim.file_mime,
      "Content-Disposition": `inline; filename="${safeFileName(claim.file_name)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
