export function formatSiteDurationMinutes(durationMinutes: number) {
  const minutes = Math.max(0, Math.round(durationMinutes));

  if (minutes < 60) {
    return `${minutes} dakika`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `${hours} saat`;
  }

  return `${hours} saat ${remainingMinutes} dakika`;
}
