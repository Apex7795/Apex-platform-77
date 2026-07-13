// components/LeadsTable.jsx
export default function LeadsTable({ leads, onStatusUpdate }) {
  return (
    <table className="min-w-full divide-y divide-gray-200">
      <thead className="hidden md:table-header-group">
        <tr>
          <th className="text-left py-2">Date</th>
          <th className="text-left py-2">Caller</th>
          <th className="text-left py-2">Status</th>
          <th className="text-left py-2">Recording</th>
        </tr>
      </thead>
      <tbody>
        {leads.map((lead) => (
          <tr key={lead.id} className="flex flex-col md:table-row border-b md:border-none p-4 md:p-0">
            <td className="md:table-cell py-1 md:py-2">
              <span className="font-bold md:hidden">Date: </span>
              {new Date(lead.created_at).toLocaleDateString()}
            </td>
            <td className="md:table-cell py-1 md:py-2">
              <span className="font-bold md:hidden">Caller: </span>
              {lead.caller_number}
            </td>
            <td className="md:table-cell py-1 md:py-2">
              <span className="font-bold md:hidden">Status: </span>
              <select value={lead.status} onChange={(e) => onStatusUpdate(lead.id, e.target.value)}>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
              </select>
            </td>
            <td className="md:table-cell py-1 md:py-2">
              <span className="font-bold md:hidden">Recording: </span>
              {lead.recording_url ? (
                <audio controls preload="none" style={{ height: '32px', maxWidth: '220px' }}>
                  <source src={`/api/leads/${lead.id}/recording`} type="audio/mpeg" />
                  Your browser does not support the audio element.
                </audio>
              ) : (
                'Pending'
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
