type Coordinates = {
  latitude: number;
  longitude: number;
};

const COORDINATE_PATTERN = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/;

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

  const decoded = decodeURIComponent(url);
  const match = decoded.match(COORDINATE_PATTERN);

  if (!match) {
    return null;
  }

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);

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
