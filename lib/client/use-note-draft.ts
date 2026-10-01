"use client";

import { useEffect, useRef, useState } from "react";
import { createClientId } from "@/lib/offline/client-id";

type Draft = { key: string; value: string; clientItemId: string; binding: string; updatedAt: number };
export type NoteSubmission = Readonly<Draft>;
export type RecoveredNoteDraft = { clientItemId: string; value: string; updatedAt: number };
const storageErrorMessage = "Taslak cihazda saklanamadı. Kaydedene kadar bu sayfayı kapatmayın.";
let lastUpdatedAt = 0;

function updatedNow() {
  lastUpdatedAt = Math.max(Date.now(), lastUpdatedAt + 1);
  return lastUpdatedAt;
}

function fresh(key: string, value = "", binding = ""): Draft {
  return { key, value, binding, clientItemId: createClientId(), updatedAt: updatedNow() };
}

// Drafts are account/project/form scoped and never replay automatically.
export function useNoteDraft(userId: string, projectId: string, scope: string) {
  const key = `kagu-saha-note-v1:${JSON.stringify([userId, projectId, scope])}`;
  const slotPrefix = `${key}:writer:`;
  const acknowledgementPrefix = `${key}:ack:`;
  const writer = useRef<string | null>(null);
  if (!writer.current) writer.current = createClientId();
  const current = useRef<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [previousDrafts, setPreviousDrafts] = useState<RecoveredNoteDraft[]>([]);
  const [persistenceError, setPersistenceError] = useState("");

  function readDrafts() {
    const rows: { storageKey: string; draft: Draft }[] = [];
    const acknowledged = new Set<string>();
    for (let index = 0; index < window.localStorage.length; index++) {
      const storageKey = window.localStorage.key(index);
      if (!storageKey || (storageKey !== key && !storageKey.startsWith(slotPrefix) && !storageKey.startsWith(acknowledgementPrefix))) continue;
      let stored;
      try { stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "null"); } catch { continue; }
      if (storageKey.startsWith(acknowledgementPrefix)) {
        if (typeof stored?.clientItemId === "string" && storageKey === `${acknowledgementPrefix}${stored.clientItemId}` &&
          typeof stored.acknowledgedAt === "number" && Number.isFinite(stored.acknowledgedAt)) acknowledged.add(stored.clientItemId);
        continue;
      }
      if (stored?.key === key && typeof stored.value === "string" && stored.value.length <= 20_000 &&
        typeof stored.clientItemId === "string" && /^[a-zA-Z0-9_-]{8,120}$/.test(stored.clientItemId) && typeof stored.binding === "string") {
        rows.push({ storageKey, draft: { key, value: stored.value, clientItemId: stored.clientItemId, binding: stored.binding,
          updatedAt: typeof stored.updatedAt === "number" && Number.isFinite(stored.updatedAt) ? stored.updatedAt : 0 } });
      }
    }
    return rows.filter(({ draft: stored }) => !acknowledged.has(stored.clientItemId)).sort((a, b) => b.draft.updatedAt - a.draft.updatedAt);
  }

  function updateAlternates(rows: ReturnType<typeof readDrafts>, value: string) {
    const byValue = new Map<string, RecoveredNoteDraft>();
    for (const { draft: stored } of rows) {
      if (stored.value && stored.value !== value && !byValue.has(stored.value)) {
        byValue.set(stored.value, { clientItemId: stored.clientItemId, value: stored.value, updatedAt: stored.updatedAt });
      }
    }
    setPreviousDrafts([...byValue.values()]);
  }

  function notifyDraftsChanged() {
    window.dispatchEvent(new window.CustomEvent("kagu-note-drafts-changed", { detail: key }));
  }

  useEffect(() => {
    let next = fresh(key);
    try {
      const rows = readDrafts();
      next = rows.find(({ draft: stored }) => stored.value)?.draft ?? next;
      updateAlternates(rows, next.value);
      setPersistenceError("");
    } catch { setPreviousDrafts([]); setPersistenceError(storageErrorMessage); }
    current.current = next;
    setDraft(next);
    function refreshAlternates() {
      try { updateAlternates(readDrafts(), current.current?.key === key ? current.current.value : ""); }
      catch { setPersistenceError(storageErrorMessage); }
    }
    function storageChanged(event: StorageEvent) {
      if (event.key === null || event.key === key || event.key.startsWith(slotPrefix) || event.key.startsWith(acknowledgementPrefix)) refreshAlternates();
    }
    function localChanged(event: Event) {
      if ((event as CustomEvent<string>).detail === key) refreshAlternates();
    }
    window.addEventListener("storage", storageChanged);
    window.addEventListener("kagu-note-drafts-changed", localChanged);
    return () => { window.removeEventListener("storage", storageChanged); window.removeEventListener("kagu-note-drafts-changed", localChanged); };
    // These helpers are scoped to the stable account/project/form key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function store(next: Draft) {
    current.current = next;
    setDraft(next);
    try {
      window.localStorage.setItem(`${slotPrefix}${writer.current}`, JSON.stringify(next));
      updateAlternates(readDrafts(), next.value);
      setPersistenceError("");
      notifyDraftsChanged();
    }
    catch { setPersistenceError(storageErrorMessage); }
  }

  function setValue(value: string) {
    const previous = current.current;
    if (!previous || previous.key !== key || previous.value === value) return;
    store(fresh(key, value, previous.binding));
  }

  function capture(binding: string): NoteSubmission {
    const previous = current.current;
    if (!previous || previous.key !== key) throw new Error("Taslak henüz hazır değil; tekrar deneyin.");
    const next = previous.binding === binding ? previous : fresh(key, previous.value, binding);
    store(next);
    return { ...next };
  }

  function restoreDraft(clientItemId: string) {
    try {
      const recovered = readDrafts().find(({ draft: stored }) => stored.clientItemId === clientItemId && stored.value)?.draft;
      if (!recovered) return false;
      // An explicit choice must not overwrite the currently edited alternative.
      writer.current = createClientId();
      store({ ...recovered, updatedAt: updatedNow() });
      return true;
    } catch { setPersistenceError(storageErrorMessage); return false; }
  }

  function acknowledge(submitted: NoteSubmission) {
    const latest = current.current;
    if (submitted.key !== key) return false;
    const stillCurrent = latest?.key === submitted.key && latest.clientItemId === submitted.clientItemId && latest.value === submitted.value;
    try {
      const acknowledgementKey = `${acknowledgementPrefix}${submitted.clientItemId}`;
      if (window.localStorage.getItem(acknowledgementKey) === null) {
        window.localStorage.setItem(acknowledgementKey, JSON.stringify({ clientItemId: submitted.clientItemId, acknowledgedAt: updatedNow() }));
      }
      // Never compare/delete another writer's mutable slot: localStorage has no CAS.
      // This writer alone can change its slot, so this synchronous removal is safe.
      const ownSlot = `${slotPrefix}${writer.current}`;
      const ownDraft = JSON.parse(window.localStorage.getItem(ownSlot) ?? "null");
      if (ownDraft?.clientItemId === submitted.clientItemId && ownDraft.value === submitted.value) window.localStorage.removeItem(ownSlot);
      if (latest?.key === key) updateAlternates(readDrafts(), stillCurrent ? "" : latest.value);
      setPersistenceError("");
    } catch { setPersistenceError(storageErrorMessage); return false; }
    if (!stillCurrent) { notifyDraftsChanged(); return false; }
    const next = fresh(key);
    current.current = next;
    setDraft(next);
    notifyDraftsChanged();
    return true;
  }

  return { value: draft?.key === key ? draft.value : "", ready: draft?.key === key, persistenceError, setValue, capture, acknowledge,
    previousDrafts: draft?.key === key ? previousDrafts : [], restoreDraft };
}
