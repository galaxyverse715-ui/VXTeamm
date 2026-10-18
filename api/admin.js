
import { json, body, db, provider, adminOK, fail } from "./_lib.js";

export default async function handler(req) {
  try {
    if (!adminOK(req)) {
      return json({ success: false, error: "Akses admin ditolak" }, 401);
    }

    if (req.method === "GET") {
      const orders = await db(
        "nokos_orders?select=*&order=created_at.desc&limit=100"
      );
      return json({ success: true, orders });
    }

    if (req.method !== "POST") {
      return json({ success: false, error: "Method tidak didukung" }, 405);
    }

    const b = await body(req);
    if (!b.id || !["approve", "reject"].includes(b.action)) {
      return json({ success: false, error: "Aksi tidak valid" }, 400);
    }

    const id = encodeURIComponent(String(b.id));
    const current = await db(
      `nokos_orders?id=eq.${id}&select=*`
    );
    const order = current?.[0];

    if (!order) {
      return json({ success: false, error: "Pesanan tidak ditemukan" }, 404);
    }

    if (order.payment_status !== "pending") {
      return json({
        success: false,
        error: "Pembayaran sudah diproses sebelumnya"
      }, 409);
    }

    if (b.action === "reject") {
      const updated = await db(
        `nokos_orders?id=eq.${id}&payment_status=eq.pending`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            payment_status: "rejected",
            order_status: "cancelled",
            updated_at: new Date().toISOString()
          })
        }
      );

      if (!updated?.length) {
        return json({ success: false, error: "Pesanan sudah diproses" }, 409);
      }

      return json({ success: true, status: "rejected" });
    }

    // Klaim pesanan secara atomik agar tidak mudah diproses dua kali.
    const claimed = await db(
      `nokos_orders?id=eq.${id}&payment_status=eq.pending`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          payment_status: "approved",
          order_status: "processing",
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!claimed?.length) {
      return json({ success: false, error: "Pesanan sudah diproses" }, 409);
    }

    try {
      const result = await provider("getNumber", {
        server: order.server_code,
        service: order.service_code,
        country: order.country_code
      }, "POST");

      const activation = result.activation;
      if (!activation?.id || !activation?.phone) {
        throw new Error("Respons provider tidak lengkap");
      }

      await db(`nokos_orders?id=eq.${id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          provider_id: String(activation.id),
          phone_number: String(activation.phone),
          provider_cost: Number(activation.cost || 0),
          order_status: "active",
          updated_at: new Date().toISOString()
        })
      });

      return json({
        success: true,
        status: "active",
        message: "Pembayaran disetujui dan nomor berhasil dipesan"
      });
    } catch (error) {
      // Jangan otomatis memesan ulang: provider mungkin sudah
      // membuat aktivasi walaupun respons sempat terputus.
      await db(`nokos_orders?id=eq.${id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          order_status: "processing",
          updated_at: new Date().toISOString()
        })
      });
      throw error;
    }
  } catch (error) {
    return fail(error);
  }
}
