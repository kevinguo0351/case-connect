// Client-side calendar helpers — no backend required.
// A slot key is an absolute wall-clock datetime: "YYYY-MM-DDTHH:mm" (30-min block),
// interpreted in the session owner's chosen IANA time zone (auto MST/MDT etc.).
// We resolve it to a true UTC instant so invites are correct for any viewer.

export const SLOT_MINUTES = 30;

const pad = (n) => String(n).padStart(2, '0');

export function toDateStr(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
export function makeSlotKey(dateStr, hour, minute) {
  return `${dateStr}T${pad(hour)}:${pad(minute)}`;
}

// Offset (ms) between a tz's wall-clock reading of `date` and true UTC.
function tzOffset(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  let hour = parseInt(p.hour, 10); if (hour === 24) hour = 0;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  return asUTC - date.getTime();
}

// Convert a wall-clock slot key in `timeZone` to a {start, end} of absolute Dates.
// Legacy/malformed keys (e.g. old "Mon-14" weekday slots) resolve to the epoch,
// so they're treated as past and quietly ignored instead of crashing the app.
export function slotToDateRange(slotKey, timeZone) {
  if (typeof slotKey !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(slotKey)) {
    return { start: new Date(0), end: new Date(0) };
  }
  const [datePart, timePart] = slotKey.split('T');
  const [Y, Mo, D] = datePart.split('-').map(Number);
  const [H, Mi] = timePart.split(':').map(Number);

  if (!timeZone) {
    const start = new Date(Y, Mo - 1, D, H, Mi, 0, 0);
    return { start, end: new Date(start.getTime() + SLOT_MINUTES * 60000) };
  }
  const guess = Date.UTC(Y, Mo - 1, D, H, Mi, 0);
  let utc = guess - tzOffset(new Date(guess), timeZone);
  utc = guess - tzOffset(new Date(utc), timeZone); // refine once for DST edges
  return { start: new Date(utc), end: new Date(utc + SLOT_MINUTES * 60000) };
}

export function isFutureSlot(slotKey, timeZone) {
  return slotToDateRange(slotKey, timeZone).start.getTime() > Date.now();
}

// Long label: "Monday, Jun 9, 14:30 MDT"
export function formatSlotTime(slotKey, timeZone) {
  const { start } = slotToDateRange(slotKey, timeZone);
  return start.toLocaleString(undefined, {
    weekday: 'long', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: timeZone || undefined, timeZoneName: 'short',
  });
}

// Compact label for chips: "Jun 9 · 14:30"
export function formatSlotShort(slotKey, timeZone) {
  const { start } = slotToDateRange(slotKey, timeZone);
  const s = start.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: timeZone || undefined,
  });
  return s.replace(', ', ' · ');
}

// Format a Date as UTC basic format: 20260608T140000Z
function toUtcStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function googleCalendarUrl({ title, details, location, start, end, guestEmail }) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    details: details || '',
    location: location || '',
    dates: `${toUtcStamp(start)}/${toUtcStamp(end)}`,
  });
  if (guestEmail) params.append('add', guestEmail);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildIcs({ title, details, location, start, end, organizerEmail, attendeeEmail }) {
  const uid = `${toUtcStamp(start)}-${Math.abs(hashString(title + attendeeEmail))}@caseconnect`;
  const esc = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CaseConnect//EN',
    'CALSCALE:GREGORIAN', 'METHOD:REQUEST', 'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toUtcStamp(new Date())}`,
    `DTSTART:${toUtcStamp(start)}`,
    `DTEND:${toUtcStamp(end)}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(details)}`,
    location ? `LOCATION:${esc(location)}` : '',
    organizerEmail ? `ORGANIZER;CN=${esc(organizerEmail)}:mailto:${organizerEmail}` : '',
    attendeeEmail ? `ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE;CN=${esc(attendeeEmail)}:mailto:${attendeeEmail}` : '',
    'STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n');
}

export function downloadIcs(ics, filename = 'caseconnect-invite.ics') {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i) | 0;
  return h;
}
