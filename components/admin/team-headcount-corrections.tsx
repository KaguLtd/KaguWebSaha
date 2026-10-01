"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { correctTeamHeadcountAction } from "@/app/(admin)/admin/schedule/actions";
import { Button } from "@/components/ui/button";

type Assignment = { id: string; name: string; planned: number | null; actual: number | null };

export function TeamHeadcountCorrections({ assignments }: { assignments: Assignment[] }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  if (!assignments.length) return null;
  return <section className="mt-5 rounded-md border border-navy/10 p-4"><h2 className="font-semibold">Sahaya gelen ekip mevcudu</h2><p className="mt-1 text-xs text-muted-foreground">Plan sayısı ve eski raporlar korunur. Fiili beyan düzeltmesi açıklamasıyla proje geçmişine kaydedilir.</p>{message ? <p role="status" className="mt-3 text-sm text-primary">{message}</p> : null}<div className="mt-3 space-y-4">{assignments.map((assignment) => <details key={assignment.id}><summary className="cursor-pointer text-sm">{assignment.name} · plan {assignment.planned ?? "bilinmiyor"} / fiili {assignment.actual ?? "beyan yok"}</summary><form className="mt-3 flex flex-col gap-3" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); setPending(true); setMessage(""); try { await correctTeamHeadcountAction(form); setMessage("Fiili ekip mevcudu kaydedildi."); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Mevcud kaydedilemedi."); } finally { setPending(false); } }}><input type="hidden" name="assignmentId" value={assignment.id} /><label className="text-sm">Fiili kişi sayısı<input className="mt-1 block w-full rounded-md border px-3 py-2" type="number" name="actualHeadcount" required min={0} max={500} step={1} defaultValue={assignment.actual ?? assignment.planned ?? ""} /></label><label className="text-sm">Doğrulama / düzeltme açıklaması<textarea className="mt-1 block w-full rounded-md border px-3 py-2" name="reason" required minLength={3} maxLength={1000} rows={2} /></label><Button disabled={pending} type="submit">{pending ? "Kaydediliyor..." : "Açıklamayla kaydet"}</Button></form></details>)}</div></section>;
}
