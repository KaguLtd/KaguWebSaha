export function getTodayDateOnly() {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

