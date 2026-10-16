import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import AnalyzePanel from './components/AnalyzePanel.jsx';
import RunReport from './components/RunReport.jsx';
import History from './components/History.jsx';
import Compare from './components/Compare.jsx';

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

  const refresh = useCallback(async () => {
    try {
      setRuns(await api.listRuns());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    api.health().then(setHealth).catch(() => setError('API is not reachable. Is the server running on port 4000?'));
  }, [refresh]);

  const openRun = async (id) => {
    try {
      setSelected(await api.getRun(id));
      setTab('analyze');
    } catch (err) {
      setError(err.message);
    }
  };

  const onCompleted = (run) => {
    setSelected(run);
    refresh();
  };

  const onDelete = async (id) => {
    await api.deleteRun(id);
    if (selected?.id === id) setSelected(null);
    refresh();
  };

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
        {tab === 'analyze' && (
          <>
            <AnalyzePanel onCompleted={onCompleted} fieldDataEnabled={health?.fieldData} />
            {selected && <RunReport run={selected} previous={previousRun(runs, selected)} />}
          </>
        )}
        {tab === 'history' && <History runs={runs} onOpen={openRun} onDelete={onDelete} onRename={async (id, label) => { await api.renameRun(id, label); refresh(); }} />}
        {tab === 'compare' && <Compare runs={runs} />}
      </main>
    </div>
  );
}

// Most recent earlier run of the same URL and device, for "vs previous" deltas.
function previousRun(runs, run) {
  return runs
    .filter((r) => r.url === run.url && r.formFactor === run.formFactor && r.createdAt < run.createdAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
}
