// 审批/拒绝留言：/api/admin/messages/:id/status
// 必须携带正确的 admin_password，否则 401。

import { ensureSchema } from "../../../messages.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// POST /api/admin/messages/:id/status  { status: "approved"|"rejected", admin_password }
export async function onRequestPost(context) {
  const { env, request, params } = context;
  await ensureSchema(env);

  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id)) {
    return json({ error: "invalid id" }, 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const status = body.status === "approved" ? "approved" : body.status === "rejected" ? "rejected" : null;
  if (!status) {
    return json({ error: "status must be 'approved' or 'rejected'" }, 400);
  }

  const admin_password = body.admin_password ? String(body.admin_password) : "";
  if (!env.ADMIN_PASSWORD || admin_password !== env.ADMIN_PASSWORD) {
    return json({ error: "unauthorized" }, 401);
  }

  const row = await env.DB.prepare(`SELECT id FROM messages WHERE id = ?`).bind(id).first();
  if (!row) {
    return json({ error: "not found" }, 404);
  }

  await env.DB.prepare(`UPDATE messages SET status = ? WHERE id = ?`).bind(status, id).run();
  return json({ ok: true });
}
