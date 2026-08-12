import { copyPolicyHash, worstCaseCopySpend, type CopyPermission } from "@/lib/copy-trading";
import { listCopyExecutions, saveCopyPermission } from "@/lib/db";
import { verifyAgentSignature } from "@/lib/agents/signature";

export const dynamic = "force-dynamic";

function policyMessage(permission: Omit<CopyPermission, "signedPolicyHash">): string {
  const hash = copyPolicyHash(permission);
  return `Mimir copy permission\npermission: ${permission.permissionId}\nowner: ${permission.ownerWallet.toLowerCase()}\npolicyHash: ${hash}`;
}

export async function POST(req: Request): Promise<Response> {
  let body: { permission?: Omit<CopyPermission, "signedPolicyHash">; signature?: `0x${string}` };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  const permission = body.permission;
  if (!permission || !body.signature) return Response.json({ error: "permission and signature required" }, { status: 400 });
  if (permission.depth !== 1 || permission.status !== "active") return Response.json({ error: "new permission must be active at depth 1" }, { status: 400 });
  const signedPolicyHash = copyPolicyHash(permission);
  const valid = await verifyAgentSignature({ address: permission.ownerWallet, message: policyMessage(permission), signature: body.signature });
  if (!valid) return Response.json({ error: "owner signature rejected" }, { status: 401 });
  const record: CopyPermission = { ...permission, signedPolicyHash };
  await saveCopyPermission(record);
  return Response.json({ permission: record, worstCase: worstCaseCopySpend(record) });
}

export async function DELETE(req: Request): Promise<Response> {
  let body: { permission?: CopyPermission; signature?: `0x${string}` };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.permission || !body.signature) return Response.json({ error: "permission and signature required" }, { status: 400 });
  const message = `Mimir revoke copy permission\npermission: ${body.permission.permissionId}\nowner: ${body.permission.ownerWallet.toLowerCase()}`;
  const valid = await verifyAgentSignature({ address: body.permission.ownerWallet, message, signature: body.signature });
  if (!valid) return Response.json({ error: "owner signature rejected" }, { status: 401 });
  const revoked: CopyPermission = { ...body.permission, status: "revoked" };
  await saveCopyPermission(revoked);
  return Response.json({ permissionId: revoked.permissionId, status: "revoked" });
}

export async function GET(req: Request): Promise<Response> {
  const permissionId = new URL(req.url).searchParams.get("permissionId")?.trim();
  if (!permissionId) return Response.json({ error: "permissionId required" }, { status: 400 });
  const executions = await listCopyExecutions(permissionId, 100);
  return Response.json({ permissionId, executions }, { headers: { "cache-control": "no-store" } });
}
