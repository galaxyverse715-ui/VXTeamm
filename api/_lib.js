
const BASE = "https://api.nomorotp.id/";

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function body(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export function adminOK(req) {
  const expected = process.env.ADMIN_TOKEN;
  const actual = req.headers.get("authorization") || "";
  return Boolean(expected) && actual === `Bearer ${expected}`;
}

export async function provider(action, params = {}, method = "GET") {
  const key = process.env.NOKOS_API_KEY;
  if (!key) throw new Error("NOKOS_API_KEY belum dikonfigurasi");

  const url = new URL(BASE);
  url.searchParams.set("action", action);

  const options = {
    method,
    headers: { "X-API-Key": key }
  };

  if (method === "POST") {
    options.headers["Content-Type"] =
      "application/x-www-form-urlencoded";
    options.body = new URLSearchParams(params).toString();
  } else {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(12000)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.success === false) {
    const err = new Error(data.message || data.error || "Provider gagal");
    err.status = response.status || 502;
    throw err;
  }

  return data;
}

export async function db(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Konfigurasi database belum lengkap");
  }

  const response = await fetch(
    `${url}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...options.headers
      },
      signal: AbortSignal.timeout(12000)
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const err = new Error("Operasi database gagal");
    err.status = 502;
    throw err;
  }

  return data;
}

export function fail(error) {
  console.error("NOKOSKU API:", error.message);
  const status = [400, 401, 403, 404, 409, 429].includes(error.status)
    ? error.status
    : 502;

  return json({
    success: false,
    error: status === 502
      ? "Layanan sementara gagal. Coba lagi."
      : error.message
  }, status);
}
