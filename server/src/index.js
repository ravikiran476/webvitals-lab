import { app } from './app.js';
import { auditEngine } from './engine.js';
import { storageInfo } from './store.js';

const PORT = Number(process.env.PORT) || 4000;

app.listen(PORT, () => {
  console.log(`WebVitals Lab API listening on http://localhost:${PORT}`);
  console.log(`Audit engine: ${auditEngine()} · storage: ${storageInfo().kind}`);
  if (process.env.ALLOWED_HOSTS) console.log(`Restricted to hosts: ${process.env.ALLOWED_HOSTS}`);
});
