const { summarizeMemory, readJsonBody, sendJson } = require('../lib/ai');

module.exports = async (req, res) => {
  const payload = await readJsonBody(req, 5e6);
  const result = await summarizeMemory({
    baseUrl: payload.baseUrl,
    apiKey: payload.apiKey,
    model: payload.model,
    content: payload.content,
    existing: payload.existing,
  });
  sendJson(res, result);
};
