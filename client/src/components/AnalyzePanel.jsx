import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function AnalyzePanel({ onCompleted, fieldDataEnabled }) {
  const [url, setUrl] = useState('');
  const [formFactor, setFormFactor] = useState('mobile');
  const [label, setLabel] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!running) return undefined;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    return () => clearInterval(t);
  }, [running]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setRunning(true);
    setElapsed(0);
    try {
      const target = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
      onCompleted(await api.createRun({ url: target, formFactor, label, authorized }));
      setLabel('');
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="card analyze">
      <form onSubmit={submit}>
        <div className="row">
          <label className="grow">
            <span>URL to audit</span>
            <input
              type="text"
              inputMode="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              disabled={running}
            />
          </label>
          <label>
            <span>Device</span>
            <select value={formFactor} onChange={(e) => setFormFactor(e.target.value)} disabled={running}>
              <option value="mobile">Mobile (throttled)</option>
              <option value="desktop">Desktop</option>
            </select>
          </label>
          <label>
            <span>Label (optional)</span>
            <input
              type="text"
              placeholder="e.g. before image CDN"
              maxLength={80}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={running}
            />
          </label>
        </div>
        <div className="row between">
          <label className="check">
            <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} disabled={running} />
            I own this site or have permission to performance-test it.
          </label>
          <button className="primary" type="submit" disabled={running || !authorized || !url.trim()}>
            {running ? `Running audit… ${elapsed}s` : 'Run Lighthouse audit'}
          </button>
        </div>
      </form>
      {running && <div className="progress" aria-hidden="true"><div /></div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {!fieldDataEnabled && (
        <p className="muted small">
          Lab data only. INP needs real-user data: set <code>CRUX_API_KEY</code> on the server to add Chrome UX Report field metrics.
        </p>
      )}
    </section>
  );
}
