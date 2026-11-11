/**
 * Poziv internog API-ja iz klijentskih ekrana.
 *
 * Jedan oblik odgovora (`{ success, data }` / `{ success: false, error }`) znači da svaki ekran
 * ne mora da ponavlja istu provjeru — ovdje se pretvara u rezultat koji se ne može promašiti.
 *
 * `data` se vraća i kad je `success: false` jer neki odgovori namjerno nose izvještaj uz grešku
 * (uvoz prekinut na redu N: ništa nije uvezeno, a korisnik treba da vidi koji je red).
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code?: string; data?: T; retryAfter?: number };

export async function apiCall<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init });
  } catch {
    return { ok: false, message: "Nema veze sa serverom. Provjerite mrežu i pokušajte ponovo." };
  }

  const body = (await response.json().catch(() => null)) as
    | { success?: boolean; data?: T; error?: { code?: string; message?: string } }
    | null;

  if (!body) return { ok: false, message: "Server nije vratio odgovor koji razumijem." };

  if (response.ok && body.success !== false) return { ok: true, data: body.data as T };

  const retryAfter = Number(response.headers?.get?.("retry-after"));
  return {
    ok: false,
    message: body.error?.message ?? "Radnja nije prošla.",
    code: body.error?.code,
    data: body.data,
    ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}),
  };
}

/** JSON tijelo za POST/PATCH — `content-type` se postavlja samo kad tijelo postoji. */
export function jsonBody(value: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}

export function patchBody(value: unknown): RequestInit {
  return { ...jsonBody(value), method: "PATCH" };
}
