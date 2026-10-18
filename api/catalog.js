
import { json, provider, fail } from "./_lib.js";

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const server = url.searchParams.get("server") || "plus";

    if (!/^[a-z0-9_-]{1,20}$/i.test(server)) {
      return json({ success: false, error: "Server tidak valid" }, 400);
    }

    const [services, countries] = await Promise.all([
      provider("getServices", { server }),
      provider("getCountries", { server })
    ]);

    return json({
      success: true,
      server,
      services: services.services || {},
      countries: countries.countries || {}
    });
  } catch (error) {
    return fail(error);
  }
}
