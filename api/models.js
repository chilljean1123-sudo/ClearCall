const { fetchModels, readJsonBody, sendJson } = require('../lib/ai');

module.exports = async (req, res) => {
  const payload = await readJsonBody(req, 1e6);
  const result = await fetchModels({
    baseUrl: payload.baseUrl,
    apiKey: payload.apiKey,
  });
  sendJson(res, result);
};
