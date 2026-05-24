const LOCATION_DESCRIPTION_PATTERN = /^Konum:\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/;

export function googleMapsUrl(latitude: string | number, longitude: string | number) {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

export function parseLocationDescription(description: string | null) {
  if (!description) {
    return null;
  }

  const match = description.match(LOCATION_DESCRIPTION_PATTERN);

  if (!match) {
    return null;
  }

  return {
    latitude: match[1],
    longitude: match[2],
    url: googleMapsUrl(match[1], match[2]),
  };
}
