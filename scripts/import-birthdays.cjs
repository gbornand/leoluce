const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const sa = require("../leoluce-edu-firebase-adminsdk-fbsvc-a47ccff020.json");
const data = require("C:/Users/GRALDI~1/AppData/Local/Temp/claude/C--Users-G-raldineBornand/a9715a10-9949-4ad9-bceb-e9eee199a1bf/scratchpad/reviewed-data.json");
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const OWNER_UIDS = {
  "Géraldine": "GoxalGBKNWcyC6OkdENgz8j1u883",
  "Philippe": "c94zHMPHU1RviAzJTUdbG7KwKyl1",
  "Lucie": "R9StFUy3BydHrhfVEaxvCwdf0dP2",
  "Léonie": "Omqf7hL1DifUBTcQESWFWzB7wU93",
};

async function run() {
  // Idempotence : n'importe rien si un import a déjà eu lieu.
  const existingLog = await db.collection("bdayImportLog").limit(1).get();
  if (!existingLog.empty) {
    console.log("Un import a déjà été journalisé — abandon pour éviter les doublons.");
    process.exit(1);
  }

  let created = 0;
  const errors = [];
  for (const d of data) {
    try {
      const ownerUid = OWNER_UIDS[d.owner] || OWNER_UIDS["Géraldine"];
      await db.collection("bdayEntries").add({
        firstName: d.firstName,
        lastName: d.lastName || null,
        day: d.day,
        month: d.month,
        birthYear: d.birthYear || null,
        category: d.category,
        ownerUid,
        group: d.group || null,
        alertEnabled: d.category === "familial",
        notes: d.note || null,
        status: d.status === "warn" ? "aConfirmer" : "ok",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      created++;
    } catch (e) {
      errors.push(`${d.firstName} (${d.day}/${d.month}): ${e.message}`);
    }
  }

  await db.collection("bdayImportLog").add({
    importedAt: FieldValue.serverTimestamp(),
    totalRows: data.length,
    okCount: data.filter(d => d.status !== "warn").length,
    aConfirmerCount: data.filter(d => d.status === "warn").length,
    createdCount: created,
    errors,
  });

  console.log(`✅ ${created} anniversaire(s) créé(s). ${errors.length} erreur(s).`);
  if (errors.length) console.error(errors);
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
