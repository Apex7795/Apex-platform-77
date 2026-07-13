import { useState, useMemo } from 'react';
import { Phone, Play, Pause, Clock, TrendingUp, AlertCircle } from 'lucide-react';

const FONT_IMPORT = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
`;

const INITIAL_LEADS = [
  { id: '1', caller: '(916) 555-0142', duration: 184, status: 'new', time: '8:14 AM', context: 'Full garage cleanout, mentioned an old washer/dryer', hasRecording: true },
  { id: '2', caller: '(916) 555-0198', duration: 96, status: 'contacted', time: '7:52 AM', context: 'Hot tub removal, second floor deck', hasRecording: true },
  { id: '3', caller: '(916) 555-0077', duration: 0, status: 'no_answer', time: '7:31 AM', context: 'Missed — auto-SMS sent', hasRecording: false },
  { id: '4', caller: '(916) 555-0210', duration: 245, status: 'won', time: 'Yesterday', context: 'Appliance haul, booked for Thursday', hasRecording: true },
  { id: '5', caller: '(916) 555-0163', duration: 58, status: 'lost', time: 'Yesterday', context: 'Went with a competitor — price', hasRecording: true },
  { id: '6', caller: '(916) 555-0089', duration: 132, status: 'quoted', time: 'Yesterday', context: 'Yard debris, waiting on photos', hasRecording: true },
];

const STATUS_CONFIG = {
  new: { label: 'NEW', color: '#E8590C', bg: '#FDECE1' },
  no_answer: { label: 'MISSED', color: '#A13D2B', bg: '#F5E3DF' },
  contacted: { label: 'CONTACTED', color: '#4A5859', bg: '#E7ECEC' },
  quoted: { label: 'QUOTED', color: '#8A6B1F', bg: '#F5EEDB' },
  won: { label: 'WON', color: '#2F6844', bg: '#E1EEE5' },
  lost: { label: 'LOST', color: '#8B8378', bg: '#EAE7E1' },
};

function formatDuration(seconds) {
  if (seconds === 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function StampBadge({ status }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <div
      className="inline-block px-2.5 py-1 border-2 rounded"
      style={{
        color: cfg.color,
        borderColor: cfg.color,
        backgroundColor: cfg.bg,
        transform: 'rotate(-2deg)',
        fontFamily: "'Oswald', sans-serif",
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.06em',
      }}
    >
      {cfg.label}
    </div>
  );
}

function LeadTicket({ lead, onStatusChange }) {
  const [playing, setPlaying] = useState(false);
  const cfg = STATUS_CONFIG[lead.status];

  return (
    <div
      className="relative mb-3 rounded-md overflow-hidden"
      style={{ backgroundColor: '#F7F4EC', boxShadow: '0 1px 3px rgba(31,36,33,0.12)' }}
    >
      {/* torn-edge top strip */}
      <div
        className="h-2"
        style={{
          backgroundImage: 'radial-gradient(circle at 6px 0px, transparent 5px, #F7F4EC 5px)',
          backgroundSize: '12px 12px',
          backgroundPosition: 'top',
          backgroundColor: '#1F2421',
        }}
      />
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <Phone size={15} style={{ color: '#4A5859' }} />
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px', color: '#1F2421', fontWeight: 500 }}>
              {lead.caller}
            </span>
          </div>
          <StampBadge status={lead.status} />
        </div>
        <p className="text-sm mb-3" style={{ fontFamily: "'Inter', sans-serif", color: '#5A5850' }}>
          {lead.context}
        </p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: '#8B8378' }}>
            <span className="flex items-center gap-1">
              <Clock size={12} /> {lead.time}
            </span>
            {lead.hasRecording && <span>{formatDuration(lead.duration)}</span>}
          </div>
          <div className="flex items-center gap-2">
            {lead.hasRecording && (
              <button
                onClick={() => setPlaying(!playing)}
                className="w-7 h-7 rounded-full flex items-center justify-center transition-colors"
                style={{ backgroundColor: playing ? '#E8590C' : '#1F2421', color: '#F7F4EC' }}
                aria-label={playing ? 'Pause recording' : 'Play recording'}
              >
                {playing ? <Pause size={12} /> : <Play size={12} style={{ marginLeft: '1px' }} />}
              </button>
            )}
            <select
              value={lead.status}
              onChange={(e) => onStatusChange(lead.id, e.target.value)}
              className="text-xs rounded border px-2 py-1 outline-none"
              style={{
                fontFamily: "'Inter', sans-serif",
                borderColor: '#D8D2C4',
                color: '#1F2421',
                backgroundColor: '#FFFFFF',
              }}
            >
              {Object.entries(STATUS_CONFIG).map(([key, c]) => (
                <option key={key} value={key}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, accent }) {
  return (
    <div className="flex-1 rounded-md p-3" style={{ backgroundColor: '#1F2421' }}>
      <div className="flex items-center gap-1.5 mb-1" style={{ color: accent }}>
        <Icon size={13} />
        <span style={{ fontFamily: "'Inter', sans-serif", fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {label}
        </span>
      </div>
      <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: '24px', fontWeight: 600, color: '#F7F4EC' }}>
        {value}
      </div>
    </div>
  );
}

export default function DispatchDashboard() {
  const [leads, setLeads] = useState(INITIAL_LEADS);

  const handleStatusChange = (id, newStatus) => {
    setLeads(leads.map((l) => (l.id === id ? { ...l, status: newStatus } : l)));
  };

  const stats = useMemo(() => {
    const won = leads.filter((l) => l.status === 'won').length;
    const lost = leads.filter((l) => l.status === 'lost').length;
    const needsAttention = leads.filter((l) => ['new', 'no_answer'].includes(l.status)).length;
    const closedTotal = won + lost;
    const conversionRate = closedTotal > 0 ? Math.round((won / closedTotal) * 100) : 0;
    return { needsAttention, won, conversionRate };
  }, [leads]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#EDE7DC' }}>
      <style>{FONT_IMPORT}</style>
      <div className="max-w-md mx-auto pb-8">
        {/* Header */}
        <div className="px-4 pt-6 pb-4" style={{ backgroundColor: '#1F2421' }}>
          <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: '11px', letterSpacing: '0.14em', color: '#E8590C', marginBottom: '2px' }}>
            RAPID HAUL JUNK REMOVAL
          </div>
          <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: '26px', fontWeight: 700, color: '#F7F4EC' }}>
            Today's Dispatch
          </h1>
          <div className="flex gap-2 mt-4">
            <KpiCard label="Needs You" value={stats.needsAttention} icon={AlertCircle} accent="#E8590C" />
            <KpiCard label="Won" value={stats.won} icon={TrendingUp} accent="#5FA97C" />
            <KpiCard label="Close Rate" value={`${stats.conversionRate}%`} icon={TrendingUp} accent="#8FA5A6" />
          </div>
        </div>
        {/* Ticket list */}
        <div className="px-4 pt-5">
          {leads.map((lead) => (
            <LeadTicket key={lead.id} lead={lead} onStatusChange={handleStatusChange} />
          ))}
        </div>
      </div>
    </div>
  );
}
