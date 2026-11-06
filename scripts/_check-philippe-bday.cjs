const admin = require('firebase-admin');
const sa = require('../leoluce-edu-firebase-adminsdk-fbsvc-a47ccff020.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('bdayUsers').get();
  snap.forEach(d => console.log(d.id, JSON.stringify(d.data())));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
