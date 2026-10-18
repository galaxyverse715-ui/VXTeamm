
import { json, body, db, provider, fail } from "./_lib.js";

export default async function handler(req) {
  try {
    if (req.method !== "POST") {
      return json({ success: false, error: "Gunakan POST" }, 405);
    }

    const b = await body(req);
    if (!b.id || !b.contact) {
      return json({ success: false, error: "ID dan kontak wajib diisi" }, 400);
    }

    const rows = await db(
      `nokos_orders?id=eq.${encodeURIComponent(b.id)}&select=*`
    );
    const order = rows?.[0];

    if (!order || order.customer_contact !== String(b.contact).trim()) {
      return json({ success: false, error: "Pesanan tidak ditemukan" }, 404);
    }

    if (
      order.payment_status !== "approved" ||
      !order.provider_id ||
      !["active", "otp_received", "completed"].includes(order.order_status)
    ) {
      return json({
        success: true,
        order: {
          id: order.id,
          payment_status: order.payment_status,
          status: order.order_status,
          phone: order.phone_number || null
        }
      });
    }

    const result = await provider("getStatus", { id: order.provider_id });
    const code = result.code || null;
    const status = String(result.status || "");

    let nextStatus = order.order_status;
    if (code) nextStatus = "otp_received";
    if (/finish|completed/i.test(status)) nextStatus = "completed";
    if (/cancel|expired|fail/i.test(status)) nextStatus = "failed";

    const patch = {
      order_status: nextStatus,
      updated_at: new Date().toISOString()
    };

    if (code) patch.otp_code = String(code).slice(0, 32);

    await db(
      `nokos_orders?id=eq.${encodeURIComponent(order.id)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(patch)
      }
    );

    return json({
      success: true,
      order: {
        id: order.id,
        status: nextStatus,
        payment_status: order.payment_status,
        phone: order.phone_number,
        otp: code
      }
    });
  } catch (error) {
    return fail(error);
  }
}
