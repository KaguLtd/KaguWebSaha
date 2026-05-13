type Coordinates = {
  latitude: number;
  longitude: number;
};

const COORDINATE_PATTERN = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/;
const AT_COORDINATE_PATTERN = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[,/]|$)/;

export function parseCoordinate(value: string) {
  const parsed = Number(value.replace(",", "."));

  return Number.isFinite(parsed) ? parsed : null;
}

export function parseLatitude(value: string) {
  const parsed = parseCoordinate(value);

  if (parsed === null || parsed < -90 || parsed > 90) {
    return null;
  }

  return parsed;
}

export function parseLongitude(value: string) {
  const parsed = parseCoordinate(value);

  if (parsed === null || parsed < -180 || parsed > 180) {
    return null;
  }

  return parsed;
}

export function parseGoogleMapsCoordinates(url: string): Coordinates | null {
  if (!url.trim()) {
    return null;
  }

  let decoded = "";

  try {
    decoded = decodeURIComponent(url);
  } catch {
    return null;
  }

  const atMatch = decoded.match(AT_COORDINATE_PATTERN);

  if (atMatch) {
    return toCoordinates(atMatch[1], atMatch[2]);
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(decoded);
  } catch {
    return null;
  }

  const queryCoordinates =
    parsedUrl.searchParams.get("q") ??
    parsedUrl.searchParams.get("query") ??
    parsedUrl.searchParams.get("ll");

  if (!queryCoordinates) {
    return null;
  }

  const match = queryCoordinates.match(COORDINATE_PATTERN);

  if (!match) {
    return null;
  }

  return toCoordinates(match[1], match[2]);
}

function toCoordinates(latitudeValue: string, longitudeValue: string) {
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
}
