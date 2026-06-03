// Client-side calendar invite helpers — no backend required.
// A slot looks like "Mon-14" (weekday + hour, local time). We resolve it to the
// NEXT upcoming occurrence of that weekday/hour and build a 1-hour event.

const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function slotToDateRange(slot) {
  const [day, hourStr] = slot.split('-');
  const hour = parseInt(hourStr, 10);
  const target = DAY_INDEX[day];

  const now = new Date();
  let daysAhead = (target - now.getDay() + 7) % 7;
  // If it's the same weekday but the hour already passed, jump to next week.
  if (daysAhead === 0 && now.getHours() >= hour) daysAhead = 7;

  const start = new Date(now);
  start.setDate(now.getDate() + daysAhead);
  start.setHours(hour, 0, 0, 0);

  const end = new Date(start);
  end.setHours(hour + 1, 0, 0, 0);

  return { start, end };
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
