// Generic SSE client registry, shared by any feature that needs to push events to
// connected dashboards. One EventSource connection per browser tab is reused across
// event types (Now Playing state, media-available toasts, ...) rather than opening
// a separate connection per feature.
const clients = new Set();

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

function addClient(res) {
  if (!hasCapacity()) return false;
  clients.add(res);
  return true;
}

function removeClient(res) {
  clients.delete(res);
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}

module.exports = { addClient, removeClient, broadcast, hasCapacity };
