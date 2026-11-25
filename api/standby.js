const { standbyLines, readJsonBody, sendJson } = require('../lib/ai');

module.exports = async (req, res) => {
  const payload = await readJsonBody(req, 1e6);
  const result = await standbyLines({
    baseUrl: payload.baseUrl,
    apiKey: payload.apiKey,
    model: payload.model,
    persona: payload.persona,
    count: payload.count,
    avoid: payload.avoid,
  });
  sendJson(res, result);
};
