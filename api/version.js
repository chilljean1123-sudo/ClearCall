module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // 每次部署 Vercel 会生成新的部署 ID / 部署域名，任一变化都视为网站已更新
  const webVersion = process.env.VERCEL_DEPLOYMENT_ID
    || process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.VERCEL_URL
    || '';
  const apkVersion = parseInt(process.env.CLEARCALL_APK_VERSION || '0', 10) || 0;
  const apkUrl = String(process.env.CLEARCALL_APK_URL || '').trim();
  const notes = String(process.env.CLEARCALL_UPDATE_NOTES || '').trim();
  res.status(200).send(JSON.stringify({ webVersion, apkVersion, apkUrl, notes }));
};
