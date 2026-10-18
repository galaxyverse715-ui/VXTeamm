
import { json, provider, fail } from "./_lib.js";

export default async function handler() {
  try {
    const result = await provider("getBalance");
    return json({
      success: true,
      provider: "connected",
      balance: result.balance
    });
  } catch (error) {
    return fail(error);
  }
}
