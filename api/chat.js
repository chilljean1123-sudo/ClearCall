const { chatReply, readJsonBody, sendJson } = require('../lib/ai');

module.exports = async (req, res) => {
  const payload = await readJsonBody(req, 5e6);
  const result = await chatReply({
    baseUrl: payload.baseUrl,
    apiKey: payload.apiKey,
    model: payload.model,
    persona: payload.persona,
    history: payload.history,
    message: payload.message,
  });
  sendJson(res, result);
};
