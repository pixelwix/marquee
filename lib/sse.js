// Generic SSE client registry, shared by any feature that needs to push events to
// connected dashboards. One EventSource connection per browser tab is reused across
// event types (Now Playing state, media-available toasts, ...) rather than opening
// a separate connection per feature.
//
// Each client carries an optional `context` (currently just req.session.user, set by
// Now Playing's stream route) alongside its response object, so a broadcast can be
// personalized per connected viewer — see lib/privacy.js — rather than every client
// getting the identical payload. A broadcast that doesn't need that (Overseerr's
// media-available toast, same for everyone) just omits the transform argument and
// behaves exactly as before.
const clients = new Map(); // res -> context

// Generous cap for a family-scale app — bounds worst-case memory/file-descriptor
// usage from a buggy or malicious client opening unbounded persistent
// connections, without ever being a real ceiling for legitimate use (one
// connection per open browser tab). Returns false when full so the caller can
// reject the request instead of registering it.
const MAX_CLIENTS = 50;

// Checked by a route before it sends SSE response headers, so a full
// connection table gets a real error status rather than headers followed by
// an immediately-closed stream. Safe to check-then-add without a race: this
// runs synchronously on Node's single event-loop thread, with no await in
// between on any caller's path.
function hasCapacity() {
  return clients.size < MAX_CLIENTS;
}

function addClient(res, context) {
  if (!hasCapacity()) return false;
  clients.set(res, context);
  return true;
}

function removeClient(res) {
  clients.delete(res);
}

/** transform(data, context) => per-client payload. Omit it to broadcast the
 * same `data` to every client unchanged (every pre-existing caller). */
function broadcast(event, data, transform) {
  for (const [res, context] of clients) {
    const payload = transform ? transform(data, context) : data;
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  }
}

module.exports = { addClient, removeClient, broadcast, hasCapacity };
