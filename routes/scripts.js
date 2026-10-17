// Settings > Scheduled Scripts: owner-only proxy to scripts-agent on arr-stack (see lib/scriptsAgent.js).
// Every edit and manual run is written to the audit log.
const express = require('express');
const requireAuth = require('./requireAuth');
const requireOwner = require('./requireOwner');
const auditLog = require('../lib/auditLog');
const agent = require('../lib/scriptsAgent');

const router = express.Router();

function fail(res, e) {
  res.status(e.status || 502).json({ error: e.message || 'Scripts agent unavailable' });
}
function audit(req, action, detail, success = true) {
  auditLog.record({
    kind: 'admin', action, actorId: req.session.user.id, actorName: req.session.user.username,
    success, statusCode: success ? 200 : 400, detail, ...auditLog.requestContext(req),
  }).catch((err) => console.error('audit log write error:', err.message));
}

router.get('/', requireAuth, requireOwner, async (req, res) => {
  try {
    const data = await agent.listJobs();
    res.json({ ...data, jobs: data.jobs.map(j => ({ ...j, scheduleText: agent.describeSchedule(j.schedule) })) });
  } catch (e) { fail(res, e); }
});

router.put('/:id', requireAuth, requireOwner, async (req, res) => {
  const { id } = req.params;
  if (!agent.ID_RE.test(id)) return res.status(400).json({ error: 'Invalid job id' });
  const { schedule, description, changesFiles } = req.body || {};
  if (schedule === undefined && description === undefined && changesFiles === undefined) return res.status(400).json({ error: 'Nothing to change' });
  try {
    const result = {};
    if (typeof schedule === 'string') {
      result.schedule = await agent.setSchedule(id, schedule);
      if (result.schedule.changed) audit(req, 'PUT /api/scripts/:id schedule', { script: result.schedule.script, from: result.schedule.from, to: result.schedule.to });
    }
    if (typeof description === 'string') {
      result.description = await agent.setDescription(id, description);
      audit(req, 'PUT /api/scripts/:id description', { script: result.description.script, length: result.description.description.length });
    }
    if (typeof changesFiles === 'boolean') {
      result.changesFiles = await agent.setChangesFiles(id, changesFiles);
      audit(req, 'PUT /api/scripts/:id changesFiles', { script: result.changesFiles.script, changesFiles: changesFiles });
    }
    res.json({ ok: true, ...result });
  } catch (e) { fail(res, e); }
});

router.post('/:id/run', requireAuth, requireOwner, async (req, res) => {
  const { id } = req.params;
  if (!agent.ID_RE.test(id)) return res.status(400).json({ error: 'Invalid job id' });
  try {
    const result = await agent.runNow(id);
    audit(req, 'POST /api/scripts/:id/run', { script: result.script, pid: result.pid });
    res.json({ ok: true, ...result });
  } catch (e) {
    audit(req, 'POST /api/scripts/:id/run', { id, error: e.message }, false);
    fail(res, e);
  }
});

module.exports = router;
