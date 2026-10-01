import { InputError } from "./input-error";

export function operationKey(userId: string, clientItemId: string) {
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(clientItemId)) {
    throw new InputError("Geçersiz işlem kimliği.");
  }
  return `${userId}:${clientItemId}`;
}

export function sameOperationPayload(stored: unknown, current: unknown) {
  // PostgreSQL JSONB can reorder object keys when a receipt is read back.
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
    return value;
  };
  return JSON.stringify(canonical(stored)) === JSON.stringify(canonical(current));
}
