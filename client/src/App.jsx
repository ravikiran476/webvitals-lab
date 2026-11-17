import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { AuthError, api, hasToken, setToken } from './api.js';
import AnalyzePanel from './components/AnalyzePanel.jsx';

// The chart views (and the charting library) load only when they are first shown.
const RunReport = lazy(() => import('./components/RunReport.jsx'));
const History = lazy(() => import('./components/History.jsx'));
const Compare = lazy(() => import('./components/Compare.jsx'));

const TABS = [
  ['analyze', 'Analyze'],
  ['history', 'History'],
  ['compare', 'Compare'],
];

export default function App() {
  const [tab, setTab] = useState('analyze');
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');
  const [needToken, setNeedToken] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRuns(await api.listRuns());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    api.health()
      .then((h) => {
        setHealth(h);
        if (h.auth && !hasToken()) setNeedToken(true);
      })
      .catch(() => setError('API is not reachable. Is the server running on port 4000?'));
  }, [refresh]);

  /** Runs an action that may need the API token, asking for it when the server says so. */
  const guarded = (action) => async (...args) => {
    try {
      return await action(...args);
    } catch (err) {
      if (err instanceof AuthError) setNeedToken(true);
      else setError(err.message);
      return undefined;
    }
  };

  const openRun = guarded(async (id) => {
    setSelected(await api.getRun(id));
    setTab('analyze');
  });

  const onCompleted = (run) => {
    setSelected(run);
    refresh();
  };

  const onDelete = guarded(async (id) => {
    await api.deleteRun(id);
    if (selected?.id === id) setSelected(null);
    refresh();
  });

  const onRename = guarded(async (id, label) => {
    await api.renameRun(id, label);
    refresh();
  });

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">◆</span>
          <div>
            <h1>WebVitals Lab</h1>
            <p className="muted">Lighthouse audits, Core Web Vitals, and before/after tracking</p>
          </div>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'tab active' : 'tab'}
              onClick={() => setTab(key)}
            >
              {label}
              {key !== 'analyze' && runs.length > 0 && <span className="count">{runs.length}</span>}
            </button>
          ))}
        </nav>
      </header>

      {needToken && <TokenBanner onSaved={() => setNeedToken(false)} />}

      {health?.storage && !health.storage.persistent && (
        <div className="banner warn" role="status">
          Run history is not being saved permanently on this deployment. Connect Upstash Redis in the Vercel project to keep it.
        </div>
      )}

      {error && (
        <div className="banner error" role="alert">
          {error}
          <button className="link" onClick={() => setError('')}>Dismiss</button>
        </div>
      )}

      <main>
        <Suspense fallback={<section className="card empty">Loading…</section>}>
          {tab === 'analyze' && (
            <>
              <AnalyzePanel onCompleted={onCompleted} onAuthError={() => setNeedToken(true)} fieldDataEnabled={health?.fieldData} />
              {selected && <RunReport run={selected} previous={previousRun(runs, selected)} />}
            </>
          )}
          {tab === 'history' && <History runs={runs} onOpen={openRun} onDelete={onDelete} onRename={onRename} />}
          {tab === 'compare' && <Compare runs={runs} />}
        </Suspense>
      </main>
    </div>
  );
}

function TokenBanner({ onSaved }) {
  const [value, setValue] = useState('');
  return (
    <form
      className="banner warn token"
      onSubmit={(e) => {
        e.preventDefault();
        setToken(value.trim());
        onSaved();
      }}
    >
      <label>
        This server needs its API token (<code>WEBVITALS_TOKEN</code>) to run audits or change runs.{' '}
        <input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="API token" aria-label="API token" />
      </label>
      <button className="primary" type="submit" disabled={!value.trim()}>Save token</button>
    </form>
  );
}

// Most recent earlier run of the same URL and device, for "vs previous" deltas.
function previousRun(runs, run) {
  return runs
    .filter((r) => r.url === run.url && r.formFactor === run.formFactor && r.createdAt < run.createdAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
}
