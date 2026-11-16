const { forumChat, readJsonBody, sendJson } = require('../lib/ai');

module.exports = async (req, res) => {
  const payload = await readJsonBody(req, 5e6);
  const result = await forumChat({
    baseUrl: payload.baseUrl,
    apiKey: payload.apiKey,
    model: payload.model,
    system: payload.system,
    user: payload.user,
    maxTokens: payload.maxTokens,
  });
  sendJson(res, result);
};
