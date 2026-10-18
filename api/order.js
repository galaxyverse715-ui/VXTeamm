
import { json, body, db, fail } from "./_lib.js";

export default async function handler(req) {
  try {
    if (req.method !== "POST") {
      return json({ success: false, error: "Gunakan POST" }, 405);
    }

    const b = await body(req);
    const {
      customer_name, customer_contact, service_code,
      service_name, country_code, country_name,
      server_code, price, payment_reference, proof_url
    } = b;

    if (
      typeof customer_name !== "string" ||
      customer_name.trim().length < 2 ||
      customer_name.length > 80 ||
      typeof customer_contact !== "string" ||
      customer_contact.trim().length < 5 ||
      customer_contact.length > 40 ||
      !/^[a-z0-9_-]{1,20}$/i.test(String(service_code || "")) ||
      !/^\d{1,5}$/.test(String(country_code || "")) ||
      !Number.isSafeInteger(price) || price < 1 ||
      typeof service_name !== "string" ||
      typeof country_name !== "string"
    ) {
      return json({ success: false, error: "Data pesanan tidak valid" }, 400);
    }

    if (!payment_reference || !proof_url) {
      return json({
        success: false,
        error: "Isi referensi transfer dan URL bukti pembayaran"
      }, 400);
    }

    // Jangan percaya harga yang dikirim browser.
    // Ambil harga dasar langsung dari provider.
    const url = new URL("https://api.nomorotp.id/");
    url.searchParams.set("action", "getPrices");
    url.searchParams.set("server", server_code || "plus");
    url.searchParams.set("country", country_code);
    url.searchParams.set("service", service_code);

    const key = process.env.NOKOS_API_KEY;
    if (!key) throw new Error("Provider belum dikonfigurasi");

    const response = await fetch(url, {
      headers: { "X-API-Key": key },
      signal: AbortSignal.timeout(12000)
    });
    const prices = await response.json();

    if (!response.ok || prices.success === false) {
      throw new Error("Harga provider gagal diambil");
    }

    const item = prices.prices?.[service_code];
    const cost = Number(item?.cost);

    if (!Number.isFinite(cost) || cost <= 0) {
      return json({ success: false, error: "Harga layanan belum tersedia" }, 409);
    }

    const markup = Number(process.env.RESELLER_MARKUP || 1000);
    if (!Number.isSafeInteger(markup) || markup < 0) {
      throw new Error("RESELLER_MARKUP tidak valid");
    }

    const officialPrice = cost + markup;

    // Harga dari frontend harus sama dengan harga server.
    if (price !== officialPrice) {
      return json({
        success: false,
        error: "Harga berubah. Muat ulang katalog.",
        price: officialPrice
      }, 409);
    }

    // Bukti harus berupa URL HTTPS dari storage yang kamu kendalikan.
    let proof;
    try {
      proof = new URL(proof_url);
    } catch {
      return json({ success: false, error: "URL bukti tidak valid" }, 400);
    }
    if (proof.protocol !== "https:") {
      return json({ success: false, error: "Bukti harus memakai HTTPS" }, 400);
    }

    const rows = await db("nokos_orders", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        customer_name: customer_name.trim(),
        customer_contact: customer_contact.trim(),
        service_code,
        service_name: service_name.slice(0, 80),
        country_code,
        country_name: country_name.slice(0, 80),
        server_code: server_code || "plus",
        price: officialPrice,
        payment_reference: String(payment_reference).slice(0, 100),
        proof_url: proof.toString()
      })
    });

    return json({
      success: true,
      order: {
        id: rows[0].id,
        price: rows[0].price,
        status: rows[0].order_status,
        payment_status: rows[0].payment_status
      }
    }, 201);
  } catch (error) {
    return fail(error);
  }
}
