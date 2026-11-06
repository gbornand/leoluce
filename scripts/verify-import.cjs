const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const sa = require("../leoluce-edu-firebase-adminsdk-fbsvc-a47ccff020.json");
initializeApp({ credential: cert(sa) });
const db = getFirestore();

async function run() {
  const snap = await db.collection("bdayEntries").get();
  console.log("Total en base:", snap.size);
  const byCat = {};
  let warn = 0;
  snap.forEach(d => { const v = d.data(); byCat[v.category] = (byCat[v.category]||0)+1; if (v.status === "aConfirmer") warn++; });
  console.log("Par catégorie:", byCat);
  console.log("À confirmer:", warn);
  const leo = snap.docs.find(d => d.data().firstName === "Léonie");
  console.log("Léonie:", leo ? leo.data() : "INTROUVABLE");
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
