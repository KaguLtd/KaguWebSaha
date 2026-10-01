import { MapPin } from "lucide-react";

import { parseLocationDescription } from "@/lib/location/maps-link";

export function LocationDescription({ description }: { description: string | null }) {
  const location = parseLocationDescription(description);

  if (!location) {
    return description ? <>{description}</> : null;
  }

  return (
    <a
      className="inline-flex items-center gap-2 font-medium text-primary hover:underline"
      href={location.url}
      rel="noreferrer"
      target="_blank"
    >
      <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
      Google Maps&apos;te ac
    </a>
  );
}
