import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex flex-col items-center justify-center px-6 py-16">
      <div className="max-w-2xl w-full text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-slate-900 text-white text-xs font-semibold px-3 py-1 mb-6">
          APEX JUNK SOLUTIONS
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 mb-4">
          Lead intelligence for field&nbsp;service
        </h1>
        <p className="text-lg text-slate-600 mb-10">
          Call tracking, conversion scoring, and automated prospect outreach — so haulers
          stop chasing leads and keep their trucks on the road.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-14">
          <Link
            href="/dashboard"
            className="inline-flex justify-center rounded-lg bg-slate-900 px-6 py-3 text-white font-semibold hover:bg-slate-700 transition-colors"
          >
            Open Dashboard
          </Link>
          <a
            href="https://github.com/Apex7795/Apex-platform-77"
            className="inline-flex justify-center rounded-lg border border-slate-300 px-6 py-3 text-slate-700 font-semibold hover:bg-white transition-colors"
          >
            View Source
          </a>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 text-left">
          <Feature title="Call Tracking" body="Every inbound call is logged, recorded, and matched to the caller's history." />
          <Feature title="Conversion Scoring" body="Prospects ranked 0–95% by likelihood to book, from real signals." />
          <Feature title="Auto Outreach" body="Personalized email sequences with built-in opt-out compliance." />
        </div>

        <p className="mt-14 text-xs text-slate-400">
          Backend API is live at <code className="text-slate-500">/api/*</code>. Dashboard data
          requires database and login setup.
        </p>
      </div>
    </main>
  );
}

function Feature({ title, body }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="font-semibold text-slate-900 mb-1">{title}</h3>
      <p className="text-sm text-slate-600">{body}</p>
    </div>
  );
}
