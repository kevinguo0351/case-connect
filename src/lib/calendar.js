// Client-side calendar invite helpers — no backend required.
// A slot looks like "Mon-14" (weekday + hour). The hour is interpreted in the
// session's chosen IANA time zone (e.g. America/Denver), which auto-handles
// MST vs MDT. We resolve it to the NEXT upcoming occurrence and build a 1-hour
// event as an absolute UTC instant, so the invite is correct for any viewer.

const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

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

// Current wall-clock parts (weekday/date/hour) in the given time zone.
function nowPartsInTz(timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date())) p[part.type] = part.value;
  let hour = parseInt(p.hour, 10); if (hour === 24) hour = 0;
  return { weekday: p.weekday, year: +p.year, month: +p.month, day: +p.day, hour };
}

export function slotToDateRange(slot, timeZone) {
  const [day, hourStr] = slot.split('-');
  const hour = parseInt(hourStr, 10);
  const target = DAY_INDEX[day];

  // Fallback: browser-local time when no time zone is given.
  if (!timeZone) {
    const now = new Date();
    let daysAhead = (target - now.getDay() + 7) % 7;
    if (daysAhead === 0 && now.getHours() >= hour) daysAhead = 7;
    const start = new Date(now);
    start.setDate(now.getDate() + daysAhead);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start);
    end.setHours(hour + 1, 0, 0, 0);
    return { start, end };
  }

  const np = nowPartsInTz(timeZone);
  let daysAhead = (target - DAY_INDEX[np.weekday] + 7) % 7;
  if (daysAhead === 0 && np.hour >= hour) daysAhead = 7;

  // Target calendar date = (tz's today) + daysAhead, via a UTC date holder.
  const base = new Date(Date.UTC(np.year, np.month - 1, np.day));
  base.setUTCDate(base.getUTCDate() + daysAhead);
  const Y = base.getUTCFullYear(), M = base.getUTCMonth() + 1, D = base.getUTCDate();

  // Convert wall-clock (Y-M-D hour:00 in tz) → UTC instant; refine once for DST.
  const guess = Date.UTC(Y, M - 1, D, hour, 0, 0);
  let utc = guess - tzOffset(new Date(guess), timeZone);
  utc = guess - tzOffset(new Date(utc), timeZone);

  const start = new Date(utc);
  const end = new Date(utc + 60 * 60 * 1000);
  return { start, end };
}

// Human-readable time in the session's time zone, e.g. "Monday, 2:00 PM MDT".
export function formatSlotTime(slot, timeZone) {
  const { start } = slotToDateRange(slot, timeZone);
  return start.toLocaleString(undefined, {
    weekday: 'long', hour: 'numeric', minute: '2-digit',
    timeZone: timeZone || undefined, timeZoneName: 'short',
  });
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
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CaseConnect//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toUtcStamp(new Date())}`,
    `DTSTART:${toUtcStamp(start)}`,
    `DTEND:${toUtcStamp(end)}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(details)}`,
    location ? `LOCATION:${esc(location)}` : '',
    organizerEmail ? `ORGANIZER;CN=${esc(organizerEmail)}:mailto:${organizerEmail}` : '',
    attendeeEmail
      ? `ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE;CN=${esc(attendeeEmail)}:mailto:${attendeeEmail}`
      : '',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n');
}

export function downloadIcs(ics, filename = 'caseconnect-invite.ics') {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i) | 0;
  return h;
}
