export function decodeName(b64: string) {
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "未知姓名";
  }
}

export function shortId(value?: string | null) {
  if (!value) return "--";
  return value.slice(0, 6);
}

export function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { hour12: false });
}

export function toLocalDateTimeParts(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { date: "", time: "" };
  }
  const offset = date.getTimezoneOffset() * 60000;
  const local = new Date(date.getTime() - offset);
  const iso = local.toISOString();
  return {
    date: iso.slice(0, 10),
    time: iso.slice(11, 16),
  };
}

export function parseLocalDateTime(dateStr: string, timeStr: string) {
  if (!dateStr || !timeStr) return null;
  const normalized =
    timeStr.length === 5 ? `${dateStr}T${timeStr}:00` : `${dateStr}T${timeStr}`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}
