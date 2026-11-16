module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const webVersion = process.env.VERCEL_DEPLOYMENT_ID
    || process.env.VERCEL_GIT_COMMIT_SHA
    || '';
  const apkVersion = parseInt(process.env.CLEARCALL_APK_VERSION || '0', 10) || 0;
  const apkUrl = String(process.env.CLEARCALL_APK_URL || '').trim();
  const notes = String(process.env.CLEARCALL_UPDATE_NOTES || '').trim();
  res.status(200).send(JSON.stringify({ webVersion, apkVersion, apkUrl, notes }));
};
