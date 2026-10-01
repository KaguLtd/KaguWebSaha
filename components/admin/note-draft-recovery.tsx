"use client";

type Props = {
  drafts: { clientItemId: string; value: string; updatedAt: number }[];
  restore: (clientItemId: string) => boolean;
  disabled?: boolean;
};

export function NoteDraftRecovery({ drafts, restore, disabled }: Props) {
  if (!drafts.length) return null;
  return <details className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
    <summary className="cursor-pointer">Diğer korunmuş taslaklar ({drafts.length})</summary>
    <ul className="mt-2 max-h-36 space-y-2 overflow-y-auto">{drafts.map((draft) => <li key={draft.clientItemId}>
      <button className="w-full rounded border border-amber-200 bg-white px-2 py-1 text-left disabled:opacity-50"
        disabled={disabled} onClick={() => restore(draft.clientItemId)} type="button">Taslağı yükle: {draft.value.slice(0, 100)}{draft.value.length > 100 ? "…" : ""}</button>
    </li>)}</ul>
  </details>;
}
