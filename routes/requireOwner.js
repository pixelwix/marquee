module.exports = function requireOwner(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not signed in' });
  if (!req.session.user.isOwner) return res.status(403).json({ error: 'Owner only' });
  next();
};
