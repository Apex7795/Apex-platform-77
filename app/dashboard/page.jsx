'use client';

// Wires the existing Dashboard component (components/Dashboard.jsx) into a real
// route. The 'use client' directive here makes this and everything it imports
// run on the client, which the Dashboard needs (useState/useEffect + fetch).
//
// Note: the leads list fetches /api/leads, which currently returns 401 until
// the tenant login system and database are set up — so the shell renders but
// the table will be empty until then.
import Dashboard from '../../components/Dashboard';

export default function DashboardPage() {
  return <Dashboard />;
}
