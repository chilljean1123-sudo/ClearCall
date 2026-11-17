const { summarizeMemory, memoryDigest, readJsonBody, sendJson } = require('../lib/ai');

module.exports = async (req, res) => {
  const payload = await readJsonBody(req, 5e6);
  if (payload.task === 'digest') {
    const digest = await memoryDigest({
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      model: payload.model,
      system: payload.system,
      user: payload.user,
      maxTokens: payload.maxTokens,
    });
    sendJson(res, digest);
    return;
  }
  const result = await summarizeMemory({
    baseUrl: payload.baseUrl,
    apiKey: payload.apiKey,
    model: payload.model,
    content: payload.content,
    existing: payload.existing,
  });
  sendJson(res, result);
};
