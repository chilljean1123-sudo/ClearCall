const { speech, readJsonBody, sendJson } = require('../lib/ai');

module.exports = async (req, res) => {
  const payload = await readJsonBody(req, 1e6);
  const result = await speech({
    baseUrl: payload.baseUrl,
    apiKey: payload.apiKey,
    model: payload.model,
    voice: payload.voice,
    input: payload.input,
  });

  if (!result.ok) {
    sendJson(res, result);
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Length', result.buffer.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(result.buffer);
};
