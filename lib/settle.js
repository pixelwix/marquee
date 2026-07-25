// Runs a promise, logging (and swallowing) a rejection under `label` and returning
// `fallback` instead — the "best-effort optional data source" pattern used anywhere
// a panel combines several upstream services and one being down shouldn't blank
// the whole response.
async function settle(label, promise, fallback) {
  try {
    return await promise;
  } catch (err) {
    console.error(`${label} error:`, err.code || err.response?.status, err.message);
    return fallback;
  }
}

module.exports = settle;
