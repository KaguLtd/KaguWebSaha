"use client";

import { useEffect, useState } from "react";
import { PersonnelArriveForm, PersonnelLeaveForm } from "./offline-task-forms";
import { LocationFields } from "./location-fields";
import { listOfflineItems } from "@/lib/offline/queue";
import { appDateKey } from "@/lib/personnel/event-policy";

type Status = "PLANNED" | "ON_SITE" | "COMPLETED";
export function PersonnelSiteActions({ status, taskId, userId, projectId, hasTodayNote, activeOtherTaskId, defaultHeadcount }: {
  status: Status; taskId: string; userId: string; projectId: string; hasTodayNote: boolean;
  activeOtherTaskId?: string; defaultHeadcount?: number | null;
}) {
  const [localStatus, setLocalStatus] = useState(status);
  const [blocked, setBlocked] = useState(Boolean(activeOtherTaskId));
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let mounted = true;
    setLocalStatus(status);
    const read = async () => {
      const items = await listOfflineItems(["PERSONNEL"], userId).catch(() => []);
      if (!mounted) return;
      const events = items.filter((item) => item.type === "PERSONNEL_EVENT" && item.status !== "FAILED");
      const own = events.filter((item) => item.type === "PERSONNEL_EVENT" && item.taskId === taskId && item.eventType !== "NOTE");
      const latest = own.at(-1);
      if (latest?.type === "PERSONNEL_EVENT") setLocalStatus(latest.eventType === "LEFT_SITE" ? "COMPLETED" : "ON_SITE");
      else setLocalStatus(status);
      setPending(own.length > 0);
      const states = new Map<string, string>();
      for (const item of events) if (item.type === "PERSONNEL_EVENT" && item.eventType !== "NOTE" && appDateKey(new Date(item.occurredAt)) === appDateKey(new Date())) states.set(item.taskId, item.eventType);
      setBlocked(Boolean(activeOtherTaskId && states.get(activeOtherTaskId) !== "LEFT_SITE") || [...states].some(([id, type]) => id !== taskId && type === "ARRIVED_SITE"));
    };
    void read();
    window.addEventListener("kagu-queue-changed", read);
    return () => { mounted = false; window.removeEventListener("kagu-queue-changed", read); };
  }, [status, taskId, userId, activeOtherTaskId]);

  return <div className="flex w-full flex-col items-center gap-4">
    {localStatus === "PLANNED" ? <PersonnelArriveForm taskId={taskId} userId={userId} projectId={projectId} disabled={blocked} disabledMessage="Önce aktif sahadaki görevi kapatmalısın." defaultHeadcount={defaultHeadcount} onStored={() => setLocalStatus("ON_SITE")}>
      <LocationFields />
      <button className="flex h-44 w-44 items-center justify-center rounded-full bg-emerald-600 px-6 text-center text-2xl font-semibold leading-tight text-white shadow-lg disabled:bg-slate-300 disabled:text-slate-600" type="submit">Sahaya Ulaştım</button>
    </PersonnelArriveForm> : null}
    {localStatus === "ON_SITE" ? <PersonnelLeaveForm taskId={taskId} userId={userId} projectId={projectId} hasTodayNote={hasTodayNote} onStored={() => setLocalStatus("COMPLETED")}><LocationFields /></PersonnelLeaveForm> : null}
    {localStatus === "COMPLETED" ? <div className="flex h-44 w-44 items-center justify-center rounded-full bg-slate-300 px-6 text-center text-2xl font-semibold text-slate-700">Tamamlandı</div> : null}
    {pending ? <p className="text-sm text-muted-foreground" role="status">Saha kaydı cihazda saklanıyor; sunucuya gönderim bekliyor.</p> : null}
  </div>;
}
