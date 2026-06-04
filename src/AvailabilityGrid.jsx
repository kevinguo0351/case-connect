import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { toDateStr, makeSlotKey } from './lib/calendar';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const VIEWS = [
  { id: '3day', label: '3 Day', days: 3 },
  { id: 'workweek', label: 'Work Week', days: 5 },
  { id: 'week', label: 'Week', days: 7 },
  { id: 'month', label: 'Month', days: 0 },
];
// 48 half-hour rows: 00:00 .. 23:30
const ROWS = Array.from({ length: 48 }, (_, i) => ({ hour: Math.floor(i / 2), minute: i % 2 ? 30 : 0 }));

const pad = (n) => String(n).padStart(2, '0');
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d) => addDays(d, -d.getDay()); // Sunday start
const sameDay = (a, b) => a.toDateString() === b.toDateString();

export default function AvailabilityGrid({ slots, timeZone, onChange }) {
  const [view, setView] = useState('week');
  const [anchor, setAnchor] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [sel, setSel] = useState(() => new Set(slots));
  const selRef = useRef(sel);
  const dragging = useRef(false);
  const dragMode = useRef('add');

  useEffect(() => { selRef.current = sel; }, [sel]);
  // Re-sync when slots change externally (e.g. autofill), but never mid-drag.
  const slotsKey = (slots || []).join('|');
  useEffect(() => { if (!dragging.current) setSel(new Set(slots || [])); }, [slotsKey]);

  useEffect(() => {
    const end = () => { if (dragging.current) { dragging.current = false; onChange(Array.from(selRef.current)); } };
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);
    return () => { window.removeEventListener('mouseup', end); window.removeEventListener('touchend', end); };
  }, [onChange]);

  const columns = useMemo(() => {
    if (view === '3day') return [0, 1, 2].map(i => addDays(anchor, i));
    if (view === 'workweek') { const mon = addDays(startOfWeek(anchor), 1); return [0, 1, 2, 3, 4].map(i => addDays(mon, i)); }
    if (view === 'week') { const sun = startOfWeek(anchor); return [0, 1, 2, 3, 4, 5, 6].map(i => addDays(sun, i)); }
    return [];
  }, [view, anchor]);

  const now = Date.now();
  const isPast = (dateStr, hour, minute) => new Date(`${dateStr}T${pad(hour)}:${pad(minute)}:00`).getTime() < now;

  const apply = (key, mode) => setSel(prev => {
    const n = new Set(prev);
    mode === 'add' ? n.add(key) : n.delete(key);
    return n;
  });
  const startDrag = (key, past) => { if (past) return; dragMode.current = sel.has(key) ? 'remove' : 'add'; dragging.current = true; apply(key, dragMode.current); };
  const enterDrag = (key, past) => { if (!dragging.current || past) return; apply(key, dragMode.current); };

  // Touch: find the cell under the finger via data attributes.
  const onTouchMove = (e) => {
    const t = e.touches[0]; if (!t) return;
    const el = document.elementFromPoint(t.clientX, t.clientY);
    const cell = el && el.closest('[data-key]');
    if (!cell) return;
    e.preventDefault();
    const key = cell.getAttribute('data-key');
    const past = cell.getAttribute('data-past') === '1';
    if (!dragging.current) startDrag(key, past); else enterDrag(key, past);
  };

  const nav = (dir) => {
    if (view === 'month') { const d = new Date(anchor); d.setMonth(d.getMonth() + dir); setAnchor(d); }
    else setAnchor(addDays(anchor, dir * (view === '3day' ? 3 : 7)));
  };
  const goToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); setAnchor(d); };

  const rangeLabel = useMemo(() => {
    if (view === 'month') return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;
    if (!columns.length) return '';
    const a = columns[0], b = columns[columns.length - 1];
    const left = `${MONTHS[a.getMonth()]} ${a.getDate()}`;
    const right = a.getMonth() === b.getMonth() ? `${b.getDate()}` : `${MONTHS[b.getMonth()]} ${b.getDate()}`;
    return `${left} – ${right}, ${b.getFullYear()}`;
  }, [view, columns, anchor]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col select-none">
      {/* Toolbar */}
      <div className="p-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => nav(-1)} className="p-1.5 rounded-md hover:bg-slate-200 text-slate-600"><ChevronLeft size={18} /></button>
          <button type="button" onClick={goToday} className="px-3 py-1.5 text-xs font-bold rounded-md border border-slate-300 hover:bg-white text-slate-600">Today</button>
          <button type="button" onClick={() => nav(1)} className="p-1.5 rounded-md hover:bg-slate-200 text-slate-600"><ChevronRight size={18} /></button>
          <span className="ml-2 font-bold text-slate-700 text-sm">{rangeLabel}</span>
        </div>
        <div className="flex bg-white border border-slate-200 rounded-lg p-0.5">
          {VIEWS.map(v => (
            <button key={v.id} type="button" onClick={() => setView(v.id)}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition ${view === v.id ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === 'month' ? (
        <MonthView anchor={anchor} sel={sel} onPickDay={(d) => { setAnchor(d); setView('3day'); }} />
      ) : (
        <div className="overflow-auto max-h-[60vh]" onTouchMove={onTouchMove}>
          <div className="min-w-[560px]">
            {/* Header row of dates (sticky) */}
            <div className="grid sticky top-0 z-10 bg-slate-50 border-b border-slate-300"
              style={{ gridTemplateColumns: `64px repeat(${columns.length}, 1fr)` }}>
              <div className="p-2 text-[10px] font-bold text-slate-400 text-center">Time</div>
              {columns.map(d => {
                const today = sameDay(d, new Date());
                return (
                  <div key={d.toISOString()} className={`p-2 text-center border-l border-slate-200 ${today ? 'bg-indigo-50' : ''}`}>
                    <div className="text-[10px] font-bold uppercase text-slate-400">{WEEKDAYS[d.getDay()]}</div>
                    <div className={`text-sm font-bold ${today ? 'text-indigo-600' : 'text-slate-700'}`}>{d.getDate()}</div>
                  </div>
                );
              })}
            </div>
            {/* Time rows */}
            {ROWS.map(({ hour, minute }) => (
              <div key={`${hour}-${minute}`} className="grid border-b border-slate-100"
                style={{ gridTemplateColumns: `64px repeat(${columns.length}, 1fr)` }}>
                <div className="py-0 px-1 text-[10px] text-slate-400 text-right pr-2 flex items-start justify-end -mt-1.5">
                  {minute === 0 ? `${pad(hour)}:00` : ''}
                </div>
                {columns.map(d => {
                  const dateStr = toDateStr(d);
                  const key = makeSlotKey(dateStr, hour, minute);
                  const past = isPast(dateStr, hour, minute);
                  const on = sel.has(key);
                  return (
                    <div key={key} data-key={key} data-past={past ? '1' : '0'}
                      onMouseDown={() => startDrag(key, past)}
                      onMouseEnter={() => enterDrag(key, past)}
                      onTouchStart={() => startDrag(key, past)}
                      className={`h-6 border-l border-slate-100 ${minute === 0 ? 'border-t border-slate-200' : ''} ${past ? 'bg-slate-50 cursor-not-allowed' : on ? 'bg-indigo-600 cursor-pointer' : 'cursor-pointer hover:bg-indigo-100'}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="px-3 py-2 text-[11px] text-slate-400 border-t border-slate-100">
        Click & drag to paint your available 30-min blocks. Drag over filled blocks to clear them.
      </div>
    </div>
  );
}

function MonthView({ anchor, sel, onPickDay }) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const counts = useMemo(() => {
    const m = {};
    for (const k of sel) { const day = k.split('T')[0]; m[day] = (m[day] || 0) + 1; }
    return m;
  }, [sel]);
  const today = new Date();

  return (
    <div className="p-3">
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map(w => <div key={w} className="text-[10px] font-bold uppercase text-slate-400 text-center py-1">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map(d => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const isToday = sameDay(d, today);
          const count = counts[toDateStr(d)] || 0;
          return (
            <button key={d.toISOString()} type="button" onClick={() => onPickDay(d)}
              className={`h-16 rounded-lg border text-left p-1.5 transition relative ${inMonth ? 'bg-white border-slate-200 hover:border-indigo-400' : 'bg-slate-50 border-slate-100 text-slate-300'} ${isToday ? 'ring-2 ring-indigo-400' : ''}`}>
              <span className={`text-xs font-bold ${inMonth ? 'text-slate-600' : 'text-slate-300'}`}>{d.getDate()}</span>
              {count > 0 && (
                <span className="absolute bottom-1.5 left-1.5 text-[10px] font-bold text-white bg-indigo-600 rounded-full px-1.5 py-0.5">{count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
