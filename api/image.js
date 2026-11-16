const { generateImage, readJsonBody, sendJson } = require('../lib/ai');

module.exports = async (req, res) => {
  const payload = await readJsonBody(req, 5e6);
  const result = await generateImage({
    baseUrl: payload.baseUrl,
    apiKey: payload.apiKey,
    model: payload.model,
    prompt: payload.prompt,
    size: payload.size,
  });
  sendJson(res, result);
};
