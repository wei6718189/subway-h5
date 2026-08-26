// 留言板主接口：GET 列表 / POST 提交
// 路由：/api/messages

const MAX_CONTENT = 500;

// 首次访问时确保表存在（幂等）
export async function ensureSchema(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '匿名',
      content TEXT NOT NULL,
      client_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'pending'
    )`
  ).run();
}

// 统一 JSON 响应
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// GET /api/messages?status=approved&page=1&limit=20
export async function onRequestGet(context) {
  const { env, request } = context;
  await ensureSchema(env);

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "approved";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10) || 20));
  const offset = (page - 1) * limit;

  const list = await env.DB.prepare(
    `SELECT id, name, content, created_at, status, client_id
     FROM messages WHERE status = ?
     ORDER BY id DESC LIMIT ? OFFSET ?`
  ).bind(status, limit, offset).all();

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM messages WHERE status = ?`
  ).bind(status).first();

  return json({
    list: list.results || [],
    total: totalRow ? totalRow.total : 0,
    page,
    limit,
  });
}

// POST /api/messages  { name, content, client_id }
export async function onRequestPost(context) {
  const { env, request } = context;
  await ensureSchema(env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const name = (body.name && String(body.name).trim()) || "匿名";
  const content = body.content ? String(body.content).trim() : "";
  let client_id = body.client_id ? String(body.client_id).trim() : "";

  if (!content) {
    return json({ error: "content required" }, 400);
  }
  if (content.length > MAX_CONTENT) {
    // 超长截断，避免破坏存储
    return json({ error: `content too long (max ${MAX_CONTENT})` }, 400);
  }
  if (!client_id) {
    client_id = crypto.randomUUID();
  }

  const result = await env.DB.prepare(
    `INSERT INTO messages (name, content, client_id, status)
     VALUES (?, ?, ?, 'pending')`
  ).bind(name, content, client_id).run();

  const inserted = await env.DB.prepare(
    `SELECT id, name, content, created_at, status, client_id
     FROM messages WHERE id = ?`
  ).bind(result.meta.last_row_id).first();

  return json(inserted, 201);
}
