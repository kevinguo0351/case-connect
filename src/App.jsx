import React, { useState, useEffect, useMemo } from 'react';
import { Clock, Check, User, ArrowRight, Star, Filter, BookOpen, Download, LogIn, RefreshCw, CalendarPlus, X, ExternalLink } from 'lucide-react';
import { collection, doc, setDoc, getDocs, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db, ensureAuth } from './firebase';
import { slotToDateRange, formatSlotTime, googleCalendarUrl, buildIcs, downloadIcs } from './lib/calendar';

const BYU_LOGO = `${import.meta.env.BASE_URL}byu-logo-white.svg`;
const LAST_USER_KEY = 'caseconnect:lastUser';

// --- CONSTANTS & CONFIG ---
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const HOURS = Array.from({ length: 13 }, (_, i) => i + 8); // 8 AM to 8 PM

const CASE_TYPES = [
  { label: "Profitability", color: "bg-blue-100 text-blue-800 border-blue-200" },
  { label: "Market Sizing", color: "bg-green-100 text-green-800 border-green-200" },
  { label: "M&A", color: "bg-purple-100 text-purple-800 border-purple-200" },
  { label: "Market Entry", color: "bg-teal-100 text-teal-800 border-teal-200" },
  { label: "Pricing", color: "bg-cyan-100 text-cyan-800 border-cyan-200" },
  { label: "Growth Strategy", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  { label: "Brainstorming", color: "bg-orange-100 text-orange-800 border-orange-200" },
  { label: "Behavioral Interview", color: "bg-rose-100 text-rose-800 border-rose-200" },
  { label: "Random Case", color: "bg-slate-800 text-white border-slate-600" },
];

const LEVELS = ["Rookie", "Intermediate", "Master", "Coach"];

// IANA zones auto-switch standard/DST (e.g. America/Denver = MST in winter, MDT now).
const TIMEZONES = [
  // United States
  { value: "America/Denver", label: "US — Mountain (MT)" },
  { value: "America/Los_Angeles", label: "US — Pacific (PT)" },
  { value: "America/Phoenix", label: "US — Arizona (no DST)" },
  { value: "America/Chicago", label: "US — Central (CT)" },
  { value: "America/New_York", label: "US — Eastern (ET)" },
  { value: "America/Anchorage", label: "US — Alaska (AKT)" },
  { value: "Pacific/Honolulu", label: "US — Hawaii (HT)" },
  // Americas (other)
  { value: "America/Toronto", label: "Canada — Eastern" },
  { value: "America/Vancouver", label: "Canada — Pacific" },
  { value: "America/Mexico_City", label: "Mexico City" },
  { value: "America/Sao_Paulo", label: "Brazil — São Paulo" },
  // Europe / Africa
  { value: "Europe/London", label: "UK — London (GMT/BST)" },
  { value: "Europe/Paris", label: "Europe — Central (Paris/Berlin)" },
  { value: "Europe/Athens", label: "Europe — Eastern (Athens)" },
  { value: "Europe/Moscow", label: "Russia — Moscow" },
  { value: "Africa/Johannesburg", label: "South Africa" },
  { value: "Africa/Cairo", label: "Egypt — Cairo" },
  // Asia / Middle East
  { value: "Asia/Dubai", label: "UAE — Dubai" },
  { value: "Asia/Kolkata", label: "India (IST)" },
  { value: "Asia/Shanghai", label: "China (Beijing/Shanghai)" },
  { value: "Asia/Hong_Kong", label: "Hong Kong" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Tokyo", label: "Japan — Tokyo" },
  { value: "Asia/Seoul", label: "South Korea — Seoul" },
  // Oceania
  { value: "Australia/Sydney", label: "Australia — Sydney" },
  { value: "Pacific/Auckland", label: "New Zealand — Auckland" },
];
const DEFAULT_TZ = "America/Denver";

export default function App() {
  const [currentView, setCurrentView] = useState('onboarding');
  const [notification, setNotification] = useState(null);

  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myUid, setMyUid] = useState(null);
  const [lastBooking, setLastBooking] = useState(null);

  const [myInfo, setMyInfo] = useState({
    name: "",
    email: "",
    level: "Rookie",
    caseType: "Profitability",
    role: "Flexible",
    timeZone: DEFAULT_TZ,
    slots: []
  });
  const [showSuggest, setShowSuggest] = useState(false);

  // Remember this device's last user (cookie-like localStorage) for instant prefill.
  const rememberUser = (info) => {
    try {
      localStorage.setItem(LAST_USER_KEY, JSON.stringify({
        name: info.name, email: info.email, level: info.level,
        caseType: info.caseType, role: info.role, timeZone: info.timeZone,
      }));
    } catch { /* storage unavailable */ }
  };

  // --- 1. Sign in anonymously FIRST, THEN live-subscribe to all sessions ---
  // (Subscribing before auth resolves would hit the rules with no request.auth
  // and permanently error the listener.)
  useEffect(() => {
    let unsub = () => {};
    ensureAuth()
      .then((uid) => {
        setMyUid(uid);
        unsub = onSnapshot(
          collection(db, 'sessions'),
          (snap) => {
            setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoading(false);
          },
          (err) => {
            console.error("Failed to load sessions:", err);
            setLoading(false);
          }
        );
      })
      .catch((err) => {
        console.error("Auth failed:", err);
        setLoading(false);
      });
    return () => unsub();
  }, []);

  // --- 1b. Prefill from this device's last login (localStorage) ---
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LAST_USER_KEY) || 'null');
      if (saved) setMyInfo(prev => ({ ...prev, ...saved }));
    } catch { /* ignore */ }
  }, []);

  // --- 2. Auto-Fill My Schedule if Found ---
  useEffect(() => {
    if (myInfo.email && sessions.length > 0) {
      const existingSession = sessions.find(s => s.email.toLowerCase() === myInfo.email.toLowerCase());
      if (existingSession) {
        const isDifferent = JSON.stringify(existingSession.slots) !== JSON.stringify(myInfo.slots);
        if (isDifferent) {
          setMyInfo(prev => ({
            ...prev,
            name: existingSession.name,
            level: existingSession.level,
            caseType: existingSession.caseType,
            role: existingSession.role,
            slots: existingSession.slots
          }));
        }
      }
    }
  }, [myInfo.email, sessions]);

  // Manual refresh fallback (data is already live via onSnapshot).
  const fetchSessions = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'sessions'));
      setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = () => {
    if (!myInfo.name || !myInfo.email) {
      alert("Please enter your Name and Email to continue.");
      return;
    }
    rememberUser(myInfo);
    setCurrentView('your-time');
  };

  // Members matching the typed name/email — lets a returning user type a word
  // and autofill the rest from the database.
  const suggestions = useMemo(() => {
    const q = myInfo.name.trim().toLowerCase();
    if (!q) return [];
    return sessions
      .filter(s => (s.name || '').toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q))
      .filter(s => (s.name || '').toLowerCase() !== q)
      .slice(0, 6);
  }, [myInfo.name, sessions]);

  const applyMember = (s) => {
    setMyInfo(prev => ({
      ...prev,
      name: s.name, email: s.email, level: s.level,
      caseType: s.caseType, role: s.role,
      timeZone: s.timeZone || DEFAULT_TZ, slots: s.slots || [],
    }));
    setShowSuggest(false);
  };

  const handleSaveSession = async () => {
    if (myInfo.slots.length === 0) {
      alert("Please select at least one time slot.");
      return;
    }
    try {
      const docId = myInfo.email.toLowerCase();
      const existing = sessions.find(s => s.id === docId);
      await setDoc(doc(db, 'sessions', docId), {
        name: myInfo.name,
        email: myInfo.email,
        level: myInfo.level,
        caseType: myInfo.caseType,
        role: myInfo.role,
        timeZone: myInfo.timeZone,
        slots: myInfo.slots,
        rating: existing?.rating ?? 'New',
        ownerUid: myUid,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      rememberUser(myInfo);

      setNotification({ title: "Availability Published!", message: "You are now live on the schedule.", type: "success" });
      setTimeout(() => {
        setNotification(null);
        setCurrentView('find-partner');
      }, 1500);
    } catch (error) {
      console.error(error);
      alert("Failed to save session. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-20">
      {notification && (
        <div className="fixed top-5 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in-down">
          <div className={`px-6 py-4 rounded-lg shadow-xl flex items-center gap-3 border ${notification.type === 'error' ? 'bg-red-50 border-red-200 text-red-900' : 'bg-teal-50 border-teal-200 text-teal-900'}`}>
            <div className={`p-2 rounded-full ${notification.type === 'error' ? 'bg-red-100' : 'bg-teal-100'}`}>
              {notification.type === 'error' ? '⚠️' : <Check size={20} className="text-teal-600" />}
            </div>
            <div>
              <h4 className="font-bold text-sm">{notification.title}</h4>
              <p className="text-xs opacity-90">{notification.message}</p>
            </div>
          </div>
        </div>
      )}

      {lastBooking && (
        <BookingConfirm booking={lastBooking} myInfo={myInfo} onClose={() => setLastBooking(null)} />
      )}

      {/* VIEW 1: ONBOARDING / LOGIN */}
      {currentView === 'onboarding' && (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 animate-in fade-in duration-700">
          <div className="mb-8 text-center">
            <div className="bg-[#002E5D] p-5 rounded-2xl inline-block mb-4 shadow-lg shadow-slate-300">
              <img src={BYU_LOGO} alt="BYU" className="h-12 w-auto" />
            </div>
            <h1 className="text-4xl font-bold text-slate-900 tracking-tight mb-2">CaseConnect</h1>
            <p className="text-slate-500 text-lg">Schedule. Practice. Succeed.</p>
          </div>
          <div className="bg-white p-8 rounded-2xl shadow-xl border border-slate-100 w-full max-w-md">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
              <LogIn size={20} className="text-indigo-600"/> Member Login
            </h2>
            <div className="space-y-4">
              <div className="relative">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Full Name</label>
                <input type="text" placeholder="e.g. Jane Doe" autoComplete="off" className="w-full p-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={myInfo.name}
                  onChange={e => { setMyInfo({...myInfo, name: e.target.value}); setShowSuggest(true); }}
                  onFocus={() => setShowSuggest(true)}
                  onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                />
                {showSuggest && suggestions.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
                    <p className="px-3 py-1.5 text-[10px] font-bold uppercase text-slate-400 bg-slate-50">Returning member? Tap to autofill</p>
                    {suggestions.map(s => (
                      <button key={s.id} type="button" onMouseDown={() => applyMember(s)}
                        className="w-full text-left px-3 py-2 hover:bg-indigo-50 transition flex justify-between items-center">
                        <span className="text-sm font-medium text-slate-800">{s.name}</span>
                        <span className="text-xs text-slate-400">{s.email}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email</label>
                <input type="email" placeholder="jane@university.edu" className="w-full p-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={myInfo.email} onChange={e => setMyInfo({...myInfo, email: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Your Level</label>
                <div className="grid grid-cols-2 gap-2">
                  {LEVELS.map(lvl => (
                    <button key={lvl} onClick={() => setMyInfo({...myInfo, level: lvl})}
                      className={`p-2 rounded-lg text-sm font-medium border transition-all ${myInfo.level === lvl ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'border-slate-200 hover:bg-slate-50 text-slate-600'}`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={handleLogin} className="w-full mt-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2">
              Enter App <ArrowRight size={18}/>
            </button>
          </div>
        </div>
      )}

      {['your-time', 'find-partner', 'resources'].includes(currentView) && (
        <>
          <nav className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
            <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="bg-[#002E5D] p-1.5 rounded-md flex items-center"><img src={BYU_LOGO} alt="BYU" className="h-6 w-auto" /></div>
                <span className="font-bold text-xl tracking-tight text-slate-800">CaseConnect</span>
              </div>
              <div className="hidden md:flex bg-slate-100 p-1 rounded-lg">
                {['your-time', 'find-partner', 'resources'].map((view) => (
                  <button key={view} onClick={() => setCurrentView(view)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all capitalize ${currentView === view ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {view.replace('-', ' ')}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 pl-4 border-l border-slate-200">
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-bold text-slate-900">{myInfo.name}</p>
                  <p className="text-[10px] text-indigo-600 font-bold uppercase tracking-wider">{myInfo.level}</p>
                </div>
                <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-bold">
                  {myInfo.name.charAt(0)}
                </div>
              </div>
            </div>
          </nav>

          <main className="max-w-6xl mx-auto px-4 py-8">
            {/* YOUR TIME TAB */}
            {currentView === 'your-time' && (
              <div className="grid lg:grid-cols-12 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="lg:col-span-3 space-y-6">
                  <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                    <h2 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><User size={18}/> Session Setup</h2>
                    <div className="space-y-4">
                      <div>
                        <label className="text-xs font-bold text-slate-500 uppercase">Topic</label>
                        <select className="w-full p-2.5 mt-1 rounded-lg border border-slate-300 text-sm bg-white"
                          value={myInfo.caseType} onChange={e => setMyInfo({...myInfo, caseType: e.target.value})}
                        >
                            {CASE_TYPES.map(c => <option key={c.label} value={c.label}>{c.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-500 uppercase">Role</label>
                        <select className="w-full p-2.5 mt-1 rounded-lg border border-slate-300 text-sm bg-white"
                          value={myInfo.role} onChange={e => setMyInfo({...myInfo, role: e.target.value})}
                        >
                          <option value="Flexible">Flexible (Both)</option>
                          <option value="Interviewer">Interviewer</option>
                          <option value="Interviewee">Interviewee</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-500 uppercase">Time Zone</label>
                        <select className="w-full p-2.5 mt-1 rounded-lg border border-slate-300 text-sm bg-white"
                          value={myInfo.timeZone} onChange={e => setMyInfo({...myInfo, timeZone: e.target.value})}
                        >
                          {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                        </select>
                        <p className="text-[11px] text-slate-400 mt-1">Your grid times are in this zone. Invites adjust automatically.</p>
                      </div>
                    </div>
                  </div>
                  <button onClick={handleSaveSession} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-md transition">
                    Confirm Schedule
                  </button>
                </div>

                <div className="lg:col-span-9 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                  <div className="p-4 border-b border-slate-200 bg-slate-50"><h2 className="font-bold text-slate-700 flex items-center gap-2"><Clock size={18}/> Weekly Availability</h2></div>
                  <div className="overflow-x-auto">
                    <div className="min-w-[600px]">
                      <div className="grid grid-cols-6 border-b border-slate-300">
                        <div className="p-3 text-xs font-bold text-slate-500 text-center bg-slate-50">Time</div>
                        {DAYS.map(day => <div key={day} className="p-3 text-sm font-bold text-slate-700 text-center bg-slate-50 border-l border-slate-300">{day}</div>)}
                      </div>
                      {HOURS.map(hour => (
                        <div key={hour} className="grid grid-cols-6 border-b border-slate-200 last:border-0">
                          <div className="p-3 text-xs font-medium text-slate-400 text-center flex items-center justify-center bg-slate-50/50">
                            {hour}:00
                          </div>
                          {DAYS.map(day => {
                            const slotId = `${day}-${hour}`;
                            const isSelected = myInfo.slots.includes(slotId);
                            return (
                              <div
                                key={slotId}
                                onClick={() => setMyInfo(prev => ({ ...prev, slots: isSelected ? prev.slots.filter(s => s !== slotId) : [...prev.slots, slotId] }))}
                                className={`
                                  border-l border-slate-200 h-12 cursor-pointer transition-all relative flex items-center justify-center
                                  ${isSelected ? 'bg-indigo-600 hover:bg-indigo-700' : 'hover:bg-indigo-50'}
                                `}
                              >
                                {isSelected && <Check size={18} className="text-white animate-in zoom-in duration-200" />}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* FIND PARTNER TAB */}
            {currentView === 'find-partner' && (
              <FindPartnerModule myInfo={myInfo} sessions={sessions} loading={loading} onRefresh={fetchSessions} setNotification={setNotification} setLastBooking={setLastBooking} />
            )}

            {/* RESOURCES TAB */}
            {currentView === 'resources' && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center gap-3 mb-6">
                  <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600"><BookOpen size={24} /></div>
                  <h1 className="text-2xl font-bold text-slate-900">Club Resources</h1>
                </div>
                <a href="https://www.byumca.com/" target="_blank" rel="noopener noreferrer"
                  className="block max-w-xl bg-white p-6 rounded-xl shadow-sm border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all">
                  <div className="flex items-center gap-4">
                    <div className="bg-[#002E5D] w-14 h-14 rounded-lg flex items-center justify-center flex-shrink-0">
                      <img src={BYU_LOGO} alt="BYU" className="h-7 w-auto" />
                    </div>
                    <div className="flex-grow">
                      <h3 className="font-bold text-slate-800 flex items-center gap-2">BYU Management Consulting Association <ExternalLink size={16} className="text-indigo-500"/></h3>
                      <p className="text-sm text-slate-500 mt-1">Case books, events, and resources on the official BYU MCA website.</p>
                    </div>
                  </div>
                </a>
              </div>
            )}
          </main>
        </>
      )}
    </div>
  );
}

function FindPartnerModule({ myInfo, sessions, loading, onRefresh, setNotification, setLastBooking }) {
  const [mode, setMode] = useState('discover');
  const [filters, setFilters] = useState({ day: 'All', type: 'All' });

  const filteredResults = useMemo(() => {
    let results = sessions;
    if (mode === 'auto') {
      return results.filter(user => {
        if (user.email === myInfo.email) return false;
        const typeMatch = user.caseType === myInfo.caseType;
        const slotMatch = user.slots.some(s => myInfo.slots.includes(s));
        return typeMatch && slotMatch;
      });
    }
    if (filters.type !== 'All') results = results.filter(u => u.caseType === filters.type);
    if (filters.day !== 'All') results = results.filter(u => u.slots.some(s => s.startsWith(filters.day)));
    return results.filter(u => u.email !== myInfo.email);
  }, [mode, filters, myInfo, sessions]);

  // --- BOOK A SLOT: Firestore transaction (atomic, prevents double-booking) ---
  const handleBookSlot = async (partnerId, slot, partnerName, partnerEmail, partnerTimeZone) => {
    try {
      await runTransaction(db, async (tx) => {
        const partnerRef = doc(db, 'sessions', partnerId);
        const snap = await tx.get(partnerRef);
        if (!snap.exists()) throw new Error('Partner not found');
        const data = snap.data();
        if (!data.slots.includes(slot)) throw new Error('Slot already taken');
        tx.update(partnerRef, { slots: data.slots.filter(s => s !== slot) });
        const bookingRef = doc(collection(db, 'bookings'));
        tx.set(bookingRef, {
          partnerEmail: data.email,
          slot,
          requesterName: myInfo.name,
          requesterEmail: myInfo.email,
          createdAt: serverTimestamp(),
        });
      });

      setNotification({ title: "Booking Confirmed!", message: `Meeting with ${partnerName} for ${slot.replace('-', ' ')}:00.`, type: "success" });
      setLastBooking({ partnerName, partnerEmail: partnerEmail || partnerId, slot, timeZone: partnerTimeZone || DEFAULT_TZ });
      onRefresh(); // (data is already live; harmless refresh)
    } catch (error) {
      setNotification({ title: "Booking Failed", message: error.message || "Someone else might have taken this slot.", type: "error" });
    }
    setTimeout(() => setNotification(null), 4000);
  };

  // --- DISPLAY LOGIC ---
  let content;
  if (loading) {
    content = <div className="col-span-2 py-12 text-center text-slate-400 animate-pulse">Loading schedule...</div>;
  } else if (filteredResults.length === 0) {
    content = (
      <div className="col-span-2 py-12 text-center text-slate-500">
        {mode === 'auto' ? 'No smart matches found yet. Try adding more time slots!' : 'No partners found matching your filters.'}
      </div>
    );
  } else {
    content = filteredResults.map(user => (
      <PartnerCard
        key={user.id}
        user={user}
        mode={mode}
        mySlots={myInfo.slots}
        filters={filters}
        onBook={handleBookSlot}
      />
    ));
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center mb-6">
         <div className="flex-1"></div>
         <div className="bg-white p-1 rounded-lg border border-slate-200 inline-flex shadow-sm">
            {['auto', 'discover'].map(m => (
              <button key={m} onClick={() => setMode(m)} className={`px-6 py-2 rounded-md text-sm font-bold capitalize transition-all ${mode === m ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:text-slate-700'}`}>{m === 'auto' ? '⚡ Smart Match' : '🔍 Discover'}</button>
            ))}
         </div>
         <div className="flex-1 flex justify-end">
            <button onClick={onRefresh} className="p-2 text-slate-400 hover:text-indigo-600 transition"><RefreshCw size={18}/></button>
         </div>
      </div>

      {mode === 'discover' && (
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-6 flex flex-wrap gap-4 items-center">
          <div className="text-sm font-bold text-slate-500 flex items-center gap-2"><Filter size={16}/> Filters:</div>
          <select className="p-2 rounded-lg border border-slate-300 text-sm bg-slate-50 focus:bg-white outline-none" value={filters.type} onChange={e => setFilters({...filters, type: e.target.value})}>
            <option value="All">All Case Types</option>
            {CASE_TYPES.map(t => <option key={t.label} value={t.label}>{t.label}</option>)}
          </select>
          <select className="p-2 rounded-lg border border-slate-300 text-sm bg-slate-50 focus:bg-white outline-none" value={filters.day} onChange={e => setFilters({...filters, day: e.target.value})}>
            <option value="All">Any Day</option>
            {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {content}
      </div>
    </div>
  );
}

function PartnerCard({ user, mode, mySlots, filters, onBook }) {
  const typeStyle = CASE_TYPES.find(t => t.label === user.caseType) || CASE_TYPES[0];
  const visibleSlots = user.slots.filter(slot => {
    if (mode === 'auto') return mySlots.includes(slot);
    if (filters.day !== 'All') return slot.startsWith(filters.day);
    return true;
  });

  return (
    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="font-bold text-slate-800">{user.name}</h3>
          <div className="flex flex-wrap items-center gap-2 mt-1">
             <span className={`text-[10px] px-2 py-0.5 rounded border font-bold ${typeStyle.color}`}>{user.caseType}</span>
             <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200 font-bold">{user.level}</span>
             <span className="text-xs text-slate-500 flex items-center gap-1"><Star size={12} className="fill-yellow-400 text-yellow-400"/> {user.rating}</span>
          </div>
        </div>
        <div className="text-xs text-right text-slate-400">{user.role}</div>
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        {visibleSlots.map(slot => (
          <button key={slot} onClick={() => onBook(user.id, slot, user.name, user.email, user.timeZone)} className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-medium text-slate-600 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 transition-colors">
            {slot.replace('-', ' ')}:00
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Calendar invite confirmation (client-side; no backend / email service) ---
function BookingConfirm({ booking, myInfo, onClose }) {
  const { start, end } = slotToDateRange(booking.slot, booking.timeZone);
  const title = `CaseConnect practice with ${booking.partnerName}`;
  const details = `Mock case interview practice via CaseConnect.\nPartner: ${booking.partnerName} (${booking.partnerEmail})\nBooked by: ${myInfo.name} (${myInfo.email})`;
  const gcalUrl = googleCalendarUrl({ title, details, start, end, guestEmail: booking.partnerEmail });

  const handleIcs = () => {
    const ics = buildIcs({ title, details, start, end, organizerEmail: myInfo.email, attendeeEmail: booking.partnerEmail });
    downloadIcs(ics);
  };

  const niceTime = formatSlotTime(booking.slot, booking.timeZone);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-300">
        <div className="bg-indigo-600 px-6 py-5 text-white flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><Check size={22}/> Booked!</h2>
            <p className="opacity-90 text-indigo-100 text-sm mt-1">Session with {booking.partnerName}</p>
          </div>
          <button onClick={onClose} className="text-indigo-200 hover:text-white transition"><X size={20}/></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-600">
            <p className="font-bold text-slate-800">{niceTime}</p>
            <p className="mt-1">Add this to your calendar and invite {booking.partnerName}.</p>
          </div>
          <a href={gcalUrl} target="_blank" rel="noopener noreferrer"
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-md transition flex items-center justify-center gap-2">
            <CalendarPlus size={18}/> Add to Google Calendar
          </a>
          <button onClick={handleIcs}
            className="w-full py-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg font-bold transition flex items-center justify-center gap-2">
            <Download size={18}/> Download .ics file
          </button>
          <p className="text-xs text-slate-400 text-center">Opening Google Calendar adds {booking.partnerName} as a guest and emails them the invite.</p>
        </div>
      </div>
    </div>
  );
}
