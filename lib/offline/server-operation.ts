import type { OfflinePendingType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { operationKey, sameOperationPayload } from "@/lib/offline/operation-key";
import { InputError } from "./input-error";

type Operation = {
  userId: string;
  clientItemId?: string;
  type: OfflinePendingType;
  payload: Prisma.InputJsonObject;
};

// The unique claim and all business writes commit together. A lost HTTP response
// can be replayed without duplicating an event, note or visit.
export async function runOfflineOperation<T extends Prisma.InputJsonObject>(
  operation: Operation,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!operation.clientItemId) return prisma.$transaction(run, { timeout: 30_000 });
  const key = operationKey(operation.userId, operation.clientItemId);
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.offlinePendingItem.create({ data: {
        userId: operation.userId, clientItemId: key, type: operation.type,
        payload: { request: operation.payload }, status: "PENDING",
      } });
      const result = await run(tx);
      await tx.offlinePendingItem.update({ where: { clientItemId: key }, data: {
        status: "SYNCED", syncedAt: new Date(), payload: { request: operation.payload, result },
      } });
      return result;
    }, { timeout: 30_000 });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
    const previous = await prisma.offlinePendingItem.findUnique({ where: { clientItemId: key } });
    const payload = previous?.payload as { request?: unknown; result?: T } | undefined;
    if (!previous || previous.userId !== operation.userId || previous.type !== operation.type ||
        !sameOperationPayload(payload?.request, operation.payload) || previous.status !== "SYNCED" || !payload?.result) {
      throw new InputError("İşlem kimliği farklı bir kayıt için kullanılmış.");
    }
    return payload.result;
  }
}
