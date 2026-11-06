const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const sa = require("../leoluce-edu-firebase-adminsdk-fbsvc-a47ccff020.json");
initializeApp({ credential: cert(sa) });
const auth = getAuth();
const db = getFirestore();

async function run() {
  const list = await auth.listUsers(1000);
  console.log(`=== ${list.users.length} compte(s) Firebase Auth (leoluce-edu) ===\n`);
  for (const u of list.users) {
    const userDoc = await db.collection("users").doc(u.uid).get();
    const bdayDoc = await db.collection("bdayUsers").doc(u.uid).get();
    const role = userDoc.exists ? userDoc.data().role : null;
    const isFamily = bdayDoc.exists;
    console.log(`${u.email} | uid=${u.uid} | role(site educatif)=${role || '—'} | compte calendrier=${isFamily ? 'oui' : 'non'} | derniere connexion=${u.metadata.lastSignInTime || 'jamais'}`);
  }
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
