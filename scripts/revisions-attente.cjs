// Traitement local des tâches « je peux attendre » de Mes révisions (cours et schémas en attente).
// Accès Firestore par ADC (gcloud auth application-default login), aucune clé.
//
//   node revisions-attente.cjs liste <dossier>                         exporte pages + consignes des tâches en attente
//   node revisions-attente.cjs cours <coursId> <extraction.json>        enregistre un cours extrait
//   node revisions-attente.cjs nouveau <eleveUid> <matiere> <extraction.json>  cours donné en fichier
//   node revisions-attente.cjs recadrer <image> <x> <y> <w> <h> <rotation> <sortie.jpg>   (x..h en fraction 0-1, rotation 0/90/180/270)
//   node revisions-attente.cjs apercu <image> <legendes.json> <sortie.png>                cases numérotées dessinées, pour vérifier
//   node revisions-attente.cjs figure <figureId> <image.jpg> <legendes.json>              enregistre un schéma prêt
//   node revisions-attente.cjs signalements                                               liste les problèmes signalés par les élèves
//   node revisions-attente.cjs traiter <signalementId>                                    marque un signalement comme traité
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const depuisFunctions = m => require(require.resolve(m, { paths: [path.join(__dirname, "..", "functions")] }));
const { initializeApp, applicationDefault } = depuisFunctions("firebase-admin/app");
const { getFirestore, FieldValue } = depuisFunctions("firebase-admin/firestore");
const { ELEVES, NOMS_MATIERES, consigneExtraction, enregistrerCoursExtrait, todayISOAnglais } = require("../functions/revisions-commun");

const SAUVEGARDES = path.join(process.env.USERPROFILE, "Dropbox", "Claude", "sauvegardes-firestore");
let db;
function base() {
  if (!db) {
    initializeApp({ credential: applicationDefault(), projectId: "leoluce-edu" });
    db = getFirestore();
  }
  return db;
}

function sauvegarder(nom, donnees) {
  const dossier = path.join(SAUVEGARDES, `leoluce-${todayISOAnglais()}`);
  fs.mkdirSync(dossier, { recursive: true });
  const fichier = path.join(dossier, `${nom}-${Date.now()}.json`);
  fs.writeFileSync(fichier, JSON.stringify(donnees, null, 1));
  return fichier;
}

function ecrireImage(dataUrl, fichier) {
  fs.writeFileSync(fichier, Buffer.from(String(dataUrl).split(",")[1] || "", "base64"));
}

async function pagesDuCours(coursId) {
  const snap = await base().collection("pagesCours").where("coursId", "==", coursId).get();
  return snap.docs.map(d => d.data()).sort((a, b) => a.page - b.page);
}

async function liste(dossier) {
  fs.mkdirSync(dossier, { recursive: true });
  const [coursSnap, figSnap] = await Promise.all([
    base().collection("coursAnglais").where("statut", "==", "attente").get(),
    base().collection("figuresRevisions").where("statut", "in", ["attente", "a_refaire"]).get(),
  ]);
  const resume = [];
  for (const d of coursSnap.docs) {
    const c = d.data();
    const profil = ELEVES[c.eleve] || { prenom: "(inconnu)", niveau: "college" };
    const rep = path.join(dossier, `cours_${d.id}`);
    fs.mkdirSync(rep, { recursive: true });
    const pages = await pagesDuCours(d.id);
    pages.forEach(p => ecrireImage(p.image, path.join(rep, `p${p.page}.jpg`)));
    fs.writeFileSync(path.join(rep, "consigne.txt"), consigneExtraction(c.matiere, profil));
    resume.push(`COURS ${d.id} · ${profil?.prenom} · ${NOMS_MATIERES[c.matiere]} · ${pages.length} page(s) · déposé le ${c.dateAjout} → ${rep}`);
  }
  for (const d of figSnap.docs) {
    const f = d.data();
    const rep = path.join(dossier, `fig_${d.id}`);
    fs.mkdirSync(rep, { recursive: true });
    const pages = f.coursId ? await pagesDuCours(f.coursId) : [];
    pages.filter(p => f.statut === "a_refaire" || !f.page || p.page === f.page).forEach(p => ecrireImage(p.image, path.join(rep, `p${p.page}.jpg`)));
    if (f.image) ecrireImage(f.image, path.join(rep, "actuelle.jpg"));
    fs.writeFileSync(path.join(rep, "info.json"), JSON.stringify({ titre: f.titre, type: f.type, page: f.page || null, statut: f.statut, legendes: f.legendes || [] }, null, 1));
    resume.push(`SCHÉMA ${d.id} · ${ELEVES[f.eleve]?.prenom} · ${NOMS_MATIERES[f.matiere]} · « ${f.titre} » · ${f.statut === "a_refaire" ? "à refaire" : `page ${f.page || "?"}`} → ${rep}`);
  }
  console.log(resume.length ? resume.join("\n") : "Aucune tâche en attente.");
}

async function cours(coursId, fichier) {
  const ref = base().collection("coursAnglais").doc(coursId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Cours introuvable");
  const c = snap.data();
  if (c.statut !== "attente") throw new Error(`Ce cours n'est pas en attente (statut : ${c.statut || "prêt"})`);
  const parsed = JSON.parse(fs.readFileSync(fichier, "utf8"));
  if (c.matiere === "dictee") parsed.grammaire = [];
  console.log("Sauvegarde :", sauvegarder(`cours_${coursId}`, c));
  await enregistrerCoursExtrait(base(), { eleve: c.eleve, matiere: c.matiere, parsed, coursId });
  const verif = (await ref.get()).data();
  const nbProg = (await base().collection("progressionAnglais").where("coursId", "==", coursId).get()).size;
  console.log(`OK « ${verif.titre} » : ${verif.vocabulaire.length} à savoir, ${verif.grammaire.length} à comprendre, ${nbProg} fiches de suivi, statut ${verif.statut || "prêt"}`);
}

// Cours donné directement en fichier (pas déposé dans l'appli) : création d'un cours prêt.
async function nouveau(eleve, matiere, fichier) {
  const profil = ELEVES[eleve];
  if (!profil || !profil.matieres.includes(matiere)) throw new Error("Élève ou matière inconnu(e)");
  const parsed = JSON.parse(fs.readFileSync(fichier, "utf8"));
  if (matiere === "dictee") parsed.grammaire = [];
  const coursId = await enregistrerCoursExtrait(base(), { eleve, matiere, parsed });
  const nbProg = (await base().collection("progressionAnglais").where("coursId", "==", coursId).get()).size;
  console.log(`OK ${profil.prenom} · ${NOMS_MATIERES[matiere]} · « ${parsed.titre} » (${coursId}) : ${nbProg} fiches de suivi`);
}

async function recadrer(image, x, y, w, h, rotation, sortie) {
  const img = sharp(image).rotate(Number(rotation) || 0);
  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  const left = Math.round(Number(x) * info.width), top = Math.round(Number(y) * info.height);
  const width = Math.min(info.width - left, Math.round(Number(w) * info.width));
  const height = Math.min(info.height - top, Math.round(Number(h) * info.height));
  for (const [dim, q] of [[1600, 85], [1300, 78], [1000, 70], [800, 60]]) {
    await sharp(data).extract({ left, top, width, height }).resize({ width: dim, height: dim, fit: "inside", withoutEnlargement: true }).jpeg({ quality: q }).toFile(sortie);
    if (fs.statSync(sortie).size < 580000) break;
  }
  const m = await sharp(sortie).metadata();
  console.log(`${sortie} : ${m.width}×${m.height}, ${Math.round(fs.statSync(sortie).size / 1024)} Ko`);
}

async function apercu(image, fichierLegendes, sortie) {
  const legendes = JSON.parse(fs.readFileSync(fichierLegendes, "utf8"));
  const { width: W, height: H } = await sharp(image).metadata();
  const cases = legendes.map((l, i) => {
    const x = l.x * W, y = l.y * H, w = l.w * W, h = l.h * H;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff3c4" stroke="#e67e22" stroke-width="2"/>
      <text x="${x + w / 2}" y="${y + h / 2}" font-size="${Math.max(12, Math.min(h * 0.7, 28))}" font-family="Arial" font-weight="bold" fill="#c0392b" text-anchor="middle" dominant-baseline="central">${i + 1}</text>`;
  }).join("");
  await sharp(image).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${cases}</svg>`) }]).png().toFile(sortie);
  console.log(`${sortie} : ${legendes.length} cases`);
}

async function figure(figureId, image, fichierLegendes) {
  const ref = base().collection("figuresRevisions").doc(figureId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Schéma introuvable");
  const f = snap.data();
  if (!["attente", "a_refaire"].includes(f.statut)) throw new Error(`Ce schéma n'est pas en attente (statut : ${f.statut || "prêt"})`);
  const legendes = JSON.parse(fs.readFileSync(fichierLegendes, "utf8")).map(l => ({ texte: String(l.texte), x: +l.x, y: +l.y, w: +l.w, h: +l.h }));
  if (legendes.length < 2 || legendes.some(l => !l.texte || [l.x, l.y, l.w, l.h].some(v => !(v >= 0 && v <= 1)))) throw new Error("Légendes invalides");
  const dataUrl = `data:image/jpeg;base64,${fs.readFileSync(image).toString("base64")}`;
  if (dataUrl.length > 800000) throw new Error("Image trop lourde (> 800 Ko en base64)");
  console.log("Sauvegarde :", sauvegarder(`figure_${figureId}`, f));
  await ref.update({ image: dataUrl, legendes, statut: FieldValue.delete(), prepareLe: new Date().toISOString() });
  const progRef = base().collection("progressionAnglais").doc(`fig_${figureId}`);
  if (!(await progRef.get()).exists) {
    await progRef.set({
      eleve: f.eleve, matiere: f.matiere, coursId: f.coursId || null, type: "figure", label: f.titre, figureId,
      niveau: 0, dernierResultat: null, prochaineDate: todayISOAnglais(), dernierVu: null,
    });
  }
  const verif = (await ref.get()).data();
  console.log(`OK « ${verif.titre} » : ${verif.legendes.length} légendes, statut ${verif.statut || "prêt"}`);
}

async function signalements() {
  const snap = await base().collection("signalementsRevisions").where("statut", "==", "nouveau").get();
  if (!snap.size) return console.log("Aucun signalement en attente.");
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  docs.forEach(s => {
    const profil = ELEVES[s.eleve] || { prenom: "(inconnu)" };
    console.log(`\n${s.id} · ${profil.prenom} · ${NOMS_MATIERES[s.matiere] || s.matiere} · ${s.correct ? "marquée JUSTE par l'appli" : "marquée FAUSSE par l'appli"} · ${s.at}
  Question : ${s.question}
  Attendu  : ${s.attendu}
  Réponse donnée : ${s.donne}`);
  });
  console.log(`\nPour marquer comme traité : node revisions-attente.cjs traiter <id>`);
}

async function traiter(id) {
  await base().collection("signalementsRevisions").doc(id).update({ statut: "traite" });
  console.log(`OK, ${id} marqué traité.`);
}

const [cmd, ...args] = process.argv.slice(2);
const actions = { liste, cours, nouveau, recadrer, apercu, figure, signalements, traiter };
if (!actions[cmd]) {
  console.log("Commandes : liste | cours | recadrer | apercu | figure | signalements | traiter (voir l'en-tête du fichier)");
  process.exit(1);
}
actions[cmd](...args).then(() => process.exit(0)).catch(e => { console.error("ERREUR :", e.message); process.exit(1); });
