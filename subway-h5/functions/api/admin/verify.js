// 管理员密码校验：/api/admin/verify
// 仅用于前端判断是否展示管理入口，真正的受保护操作仍需再次校验密码。

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// POST /api/admin/verify  { password }
export async function onRequestPost(context) {
  const { env, request } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false }, 401);
  }

  const password = body.password ? String(body.password) : "";
  if (env.ADMIN_PASSWORD && password === env.ADMIN_PASSWORD) {
    return json({ ok: true });
  }
  return json({ ok: false }, 401);
}
