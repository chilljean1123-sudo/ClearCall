const { wxPusherPush, readJsonBody, sendJson } = require('../lib/ai');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, reason: '只支持 POST' }));
    return;
  }
  const payload = await readJsonBody(req, 1e5);
  const result = await wxPusherPush({
    spt: payload.spt,
    summary: payload.summary,
    content: payload.content,
  });
  sendJson(res, result);
};
