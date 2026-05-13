"use client";

import { useEffect, useState } from "react";

export function LocationFields() {
  const [location, setLocation] = useState<{
    latitude: string;
    longitude: string;
  }>({
    latitude: "",
    longitude: "",
  });

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: String(position.coords.latitude),
          longitude: String(position.coords.longitude),
        });
      },
      () => {
        setLocation({
          latitude: "",
          longitude: "",
        });
      },
      {
        enableHighAccuracy: true,
        maximumAge: 60000,
        timeout: 8000,
      },
    );
  }, []);

  return (
    <>
      <input name="latitude" type="hidden" value={location.latitude} />
      <input name="longitude" type="hidden" value={location.longitude} />
    </>
  );
}

export function LocationTestButton() {
  const [message, setMessage] = useState("Konum testi hazir.");

  function testLocation() {
    if (!("geolocation" in navigator)) {
      setMessage("Bu tarayici konum desteklemiyor.");
      return;
    }

    setMessage("Konum aliniyor...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setMessage(
          `Konum alindi: ${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`,
        );
      },
      () => {
        setMessage("Konum izni verilmedi veya konum alinamadi.");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 8000,
      },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        className="rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-muted"
        onClick={testLocation}
        type="button"
      >
        Son konum gonderme testi
      </button>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
