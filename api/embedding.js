const { embedding, readJsonBody, sendJson } = require('../lib/ai');

module.exports = async (req, res) => {
  const payload = await readJsonBody(req, 5e6);
  const result = await embedding({
    baseUrl: payload.baseUrl,
    apiKey: payload.apiKey,
    model: payload.model,
    inputs: payload.inputs,
  });
  sendJson(res, result);
};
