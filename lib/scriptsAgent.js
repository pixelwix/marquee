// Client for scripts-agent on arr-stack (CT102): lists the cron jobs that run /mnt/docker/scripts/*,
// edits a job's schedule/description, and starts a job now. Powers Settings > Scheduled Scripts.
// The agent itself enforces an IP allowlist + bearer token, validates every edit, backs up the crontab
// before changing it, and refuses to start a second copy of a job that's already running.

const ID_RE = /^[a-f0-9]{10}$/;

function config() {
  const url = (process.env.SCRIPTS_AGENT_URL || '').replace(/\/+$/, '');
  const token = process.env.SCRIPTS_AGENT_TOKEN || '';
  return { url, token, configured: !!(url && token) };
}

async function call(method, path, body) {
  const { url, token, configured } = config();
  if (!configured) {
    const err = new Error('Scripts agent is not configured (SCRIPTS_AGENT_URL / SCRIPTS_AGENT_TOKEN)');
    err.status = 503;
    throw err;
  }
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(method === 'GET' ? 15000 : 10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Scripts agent HTTP ${res.status}`);
    err.status = res.status === 400 ? 400 : 502;
    throw err;
  }
  return data;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function clock(h, m) {
  const hh = Number(h), mm = Number(m);
  const suffix = hh < 12 ? 'AM' : 'PM';
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, '0')} ${suffix}`;
}

// Plain-English summary of the common cron shapes used here; anything unusual falls back to the raw expression.
function describeSchedule(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return expr || '';
  const [min, hour, dom, mon, dow] = parts;
  const allDays = dom === '*' && mon === '*' && dow === '*';
  const isNum = s => /^\d+$/.test(s);
  if (allDays && min === '*' && hour === '*') return 'Every minute';
  let m;
  if (allDays && hour === '*' && (m = min.match(/^\*\/(\d+)$/))) return `Every ${m[1]} minutes`;
  if (allDays && hour === '*' && isNum(min)) return `Hourly at :${min.padStart(2, '0')}`;
  if (allDays && hour === '*' && /^\d+(,\d+)+$/.test(min)) return `Hourly at ${min.split(',').map(x => `:${x.padStart(2, '0')}`).join(', ')}`;
  if (allDays && isNum(min) && (m = hour.match(/^\*\/(\d+)$/))) return `Every ${m[1]} hours at :${min.padStart(2, '0')}`;
  if (allDays && isNum(min) && isNum(hour)) return `Daily at ${clock(hour, min)}`;
  if (dom === '*' && mon === '*' && isNum(dow) && isNum(min) && isNum(hour)) return `Weekly on ${DAYS[Number(dow)]} at ${clock(hour, min)}`;
  if (mon === '*' && dow === '*' && isNum(dom) && isNum(min) && isNum(hour)) return `Monthly on day ${dom} at ${clock(hour, min)}`;
  return expr;
}

module.exports = {
  ID_RE,
  configured: () => config().configured,
  describeSchedule,
  listJobs: () => call('GET', '/jobs'),
  setSchedule: (id, schedule) => call('PUT', `/jobs/${id}/schedule`, { schedule }),
  setDescription: (id, description) => call('PUT', `/jobs/${id}/description`, { description }),
  setChangesFiles: (id, changesFiles) => call('PUT', `/jobs/${id}/changes-files`, { changesFiles }),
  runNow: id => call('POST', `/jobs/${id}/run`),
};
