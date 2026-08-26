// 删除留言：/api/messages/:id
// 鉴权二选一：body 带 client_id（删自己的）或 admin_password（管理员删任意）
import { ensureSchema } from "../messages.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// DELETE /api/messages/:id
export async function onRequestDelete(context) {
  const { env, request, params } = context;
  await ensureSchema(env);
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id)) {
    return json({ error: "invalid id" }, 400);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    // 允许无 body
  }

  const client_id = body.client_id ? String(body.client_id).trim() : "";
  const admin_password = body.admin_password ? String(body.admin_password) : "";

  const row = await env.DB.prepare(
    `SELECT client_id FROM messages WHERE id = ?`
  ).bind(id).first();

  if (!row) {
    return json({ error: "not found" }, 404);
  }

  const isOwner = client_id && row.client_id === client_id;
  const isAdmin = admin_password && env.ADMIN_PASSWORD && admin_password === env.ADMIN_PASSWORD;

  if (!isOwner && !isAdmin) {
    return json({ error: "forbidden" }, 403);
  }

  await env.DB.prepare(`DELETE FROM messages WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}
