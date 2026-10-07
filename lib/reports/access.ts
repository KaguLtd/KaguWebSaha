import { getCurrentUser } from "../auth/session";

/** JSON APIs must not redirect an unauthorized request into an HTML page. */
export async function reportApiUser() {
  const user = await getCurrentUser();
  if (!user) return { user: null, response: Response.json({ ok: false, error: "Oturum süresi doldu." }, { status: 401 }) };
  if (user.role !== "ADMIN") return { user: null, response: Response.json({ ok: false, error: "Raporlara erişim yetkiniz yok." }, { status: 403 }) };
  return { user, response: null };
}
