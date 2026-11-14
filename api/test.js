const { testConnection, readJsonBody, sendJson } = require('../lib/ai');

module.exports = async (req, res) => {
  const payload = await readJsonBody(req, 1e6);
  const result = await testConnection({
    baseUrl: payload.baseUrl,
    apiKey: payload.apiKey,
    model: payload.model,
  });
  sendJson(res, result);
};
