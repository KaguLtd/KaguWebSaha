"use client";

export type JsonRequestErrorCode = "AUTH" | "TIMEOUT" | "NETWORK" | "INVALID_RESPONSE" | "HTTP";

export class JsonRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: JsonRequestErrorCode) {
    super(message);
    this.name = "JsonRequestError";
  }
}

/** Require an explicit JSON {ok:true} ACK, bounded through headers AND body decoding.
 * Callers must additionally validate their operation-specific fields before changing a draft.
 */
export async function requestJson<T extends { ok: true }>(url: string, options: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const abort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  externalSignal?.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new JsonRequestError("Sunucu yanıtı zamanında alınamadı. Kayıt korunuyor; tekrar deneyin.", 0, "TIMEOUT"));
      controller.abort();
    }, timeoutMs);
  });
  const operation = (async () => {
    const response = await fetch(url, { ...options, cache: "no-store", signal: controller.signal });
    if (response.redirected || response.status === 401) {
      throw new JsonRequestError("Oturum süresi doldu. Kayıt korundu; tekrar giriş yapın.", 401, "AUTH");
    }
    let payload: unknown;
    try { payload = await response.json(); }
    catch {
      if (!response.ok) throw new JsonRequestError("Sunucu isteği kabul etmedi. Kayıt korunuyor.", response.status || 503, "HTTP");
      throw new JsonRequestError("Sunucudan geçerli kayıt onayı alınamadı. Kayıt korunuyor.", 503, "INVALID_RESPONSE");
    }
    const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
    if (!response.ok) {
      throw new JsonRequestError(typeof record?.error === "string" ? record.error : "Sunucu isteği kabul etmedi. Kayıt korunuyor.", response.status || 503, "HTTP");
    }
    if (record?.ok !== true) throw new JsonRequestError("Sunucudan geçerli kayıt onayı alınamadı. Kayıt korunuyor.", 503, "INVALID_RESPONSE");
    return record as T;
  })();
  try { return await Promise.race([operation, timeout]); }
  catch (error) {
    if (error instanceof JsonRequestError) throw error;
    throw new JsonRequestError("Bağlantı kesildi. Kayıt korunuyor; tekrar deneyin.", 0, "NETWORK");
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abort);
  }
}
