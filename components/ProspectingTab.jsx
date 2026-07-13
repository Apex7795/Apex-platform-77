// components/ProspectingTab.jsx
//
// SECURITY NOTE: the routes this component calls (/api/prospects/*) are
// now gated by lib/adminAuth.js's bearer-token check — but that check is
// designed for server-to-server calls (scripts, cron, curl), not browser
// JS. A static ADMIN_API_TOKEN must NOT be embedded in this component or
// any client bundle — anyone could read it out of devtools/network tab
// and call the admin API directly. Before this component goes live, it
// needs to sit behind real session-based admin auth (a login cookie
// checked server-side), with these fetch calls either carrying that
// session cookie automatically (same-origin, so they already do, once
// that session system exists) or going through a server-side proxy that
// attaches the bearer token on the component's behalf. As shipped, this
// component has no working auth story yet — the API being gated doesn't
// mean this UI is.
import { useState, useEffect } from 'react';

const STATUS_LABELS = {
  discovered: 'Discovered',
  enriched: 'Enriched',
  contacted: 'Contacted',
  replied: 'Replied',
  converted: 'Converted',
  opted_out: 'Opted Out',
};

export default function ProspectingTab() {
  const [prospects, setProspects] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [discoverCity, setDiscoverCity] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [outreachBusyId, setOutreachBusyId] = useState(null);

  const loadProspects = async () => {
    setLoading(true);
    const qs = statusFilter ? `?status=${statusFilter}` : '';
    try {
      const res = await fetch(`/api/prospects${qs}`);
      const data = await res.json();
      setProspects(Array.isArray(data.prospects) ? data.prospects : []);
    } catch (err) {
      console.error('Failed to load prospects:', err);
      setProspects([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProspects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handleDiscover = async () => {
    if (!discoverCity.trim()) return;
    setDiscovering(true);
    try {
      const res = await fetch('/api/prospects/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city: discoverCity }),
      });
      if (!res.ok) throw new Error('Discovery run failed');
      await loadProspects();
    } catch (err) {
      alert(err.message);
    } finally {
      setDiscovering(false);
    }
  };

  const handleOutreach = async (id) => {
    setOutreachBusyId(id);
    try {
      const res = await fetch(`/api/prospects/${id}/outreach`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Outreach failed');
      await loadProspects();
    } catch (err) {
      alert(err.message);
    } finally {
      setOutreachBusyId(null);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Prospecting</h1>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="City, e.g. Sacramento, CA"
          value={discoverCity}
          onChange={(e) => setDiscoverCity(e.target.value)}
          className="border rounded px-3 py-1.5 flex-1"
        />
        <button
          onClick={handleDiscover}
          disabled={discovering}
          className="bg-black text-white rounded px-4 py-1.5 disabled:opacity-50"
        >
          {discovering ? 'Running...' : 'Run Discovery'}
        </button>
      </div>

      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        className="border rounded px-2 py-1 mb-4"
      >
        <option value="">All statuses</option>
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>

      {loading ? (
        <div>Loading prospects...</div>
      ) : (
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr>
              <th className="text-left py-2">Business</th>
              <th className="text-left py-2">City</th>
              <th className="text-left py-2">Email</th>
              <th className="text-left py-2">Status</th>
              <th className="text-left py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {prospects.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="py-2">{p.business_name}</td>
                <td className="py-2">{p.city || '—'}</td>
                <td className="py-2">{p.email || 'Not enriched'}</td>
                <td className="py-2">
                  {p.opted_out ? 'Opted Out' : STATUS_LABELS[p.status] || p.status}
                </td>
                <td className="py-2">
                  <button
                    onClick={() => handleOutreach(p.id)}
                    disabled={p.opted_out || !p.email || outreachBusyId === p.id}
                    className="bg-blue-600 text-white rounded px-3 py-1 text-sm disabled:opacity-40"
                    title={!p.email ? 'No enriched email on file' : ''}
                  >
                    {outreachBusyId === p.id ? 'Sending...' : 'One-Click Outreach'}
                  </button>
                </td>
              </tr>
            ))}
            {prospects.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-gray-500">
                  No prospects yet — run a discovery search above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
