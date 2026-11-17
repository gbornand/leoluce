const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const fs = require("fs");
const path = require("path");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const nodemailer = require("nodemailer");
const Anthropic = require("@anthropic-ai/sdk");

initializeApp();
const db = getFirestore();

const SMTP_USER = "contact@leoluce.com";
const SMTP_PASS = defineSecret("SMTP_PASS");

function parisParts(date) {
  const s = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", hourCycle: "h23",
  }).format(date);
  const [datePart, hourPart] = s.split(" ");
  const [day, month, year] = datePart.split("/").map(Number);
  return { day, month, year, hour: Number(hourPart) };
}

function fullName(e) {
  return [e.firstName, e.lastName].filter(Boolean).join(" ");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function ageAt(entry, year) {
  return entry.birthYear ? year - entry.birthYear : null;
}

function transporter() {
  return nodemailer.createTransport({
    host: "ssl0.ovh.net", port: 465, secure: true,
    auth: { user: SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function activeFamilyUsers() {
  const snap = await db.collection("bdayUsers").get();
  return snap.docs.map(d => ({ uid: d.id, ...d.data() })).filter(u => u.email);
}

const FAMILIAL_COLOR = "#4caf50", AMIS_FAMILLE_COLOR = "#7a5cc0", ENFANTS_AMIS_COLOR = "#c07a3f";
function colorForEntry(entry, bdayUsersByUid) {
  if (entry.category === "familial") return FAMILIAL_COLOR;
  if (entry.category === "amis_famille") return AMIS_FAMILLE_COLOR;
  if (entry.category === "enfants_amis") return ENFANTS_AMIS_COLOR;
  return bdayUsersByUid[entry.ownerUid]?.colorHex || "#999";
}

// Famille proche (foyer) — anniversaire de l'un d'eux = toujours mis en avant, distinct des
// amis/famille élargie même si aussi suivis dans le calendrier.
const DIRECT_FAMILY_UIDS = new Set([
  "GoxalGBKNWcyC6OkdENgz8j1u883", // Géraldine
  "BmPJ62Hhb0V572vQgzwzybbnU8s2", // Lucie
  "PKRatKwnzDZt0BzZjMfO3PFnGxU2", // Léonie
  "Dvourw0h9CPITNITKgpDlEBZXPT2", // Philippe
]);
function isDirectFamily(entry) { return DIRECT_FAMILY_UIDS.has(entry.ownerUid); }
function isMilestoneAge(age) { return age != null && age > 0 && age % 10 === 0; }

function renderEmailRow(dotColor, label, value, special) {
  const rowStyle = special
    ? "padding:12px 10px;border-bottom:1px solid #ece3d6;background:#fbe7e0;border-radius:8px;"
    : "padding:9px 0;border-bottom:1px solid #ece3d6;";
  const labelStyle = special ? "font-weight:800;font-size:16px;color:#c0392b;" : "font-weight:700;font-size:15px;color:#2d2a26;";
  const valueStyle = special ? "font-weight:800;font-size:14px;color:#c0392b;" : "color:#8a8175;font-size:13px;";
  return `<tr>
    <td style="${rowStyle}">
      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${dotColor};margin-right:10px;vertical-align:middle;"></span>
      <span style="${labelStyle}vertical-align:middle;">${special ? "🎉 " : ""}${label}</span>
    </td>
    <td style="${rowStyle}text-align:right;${valueStyle}white-space:nowrap;">${value}</td>
  </tr>`;
}

// ═══════════════════════════════════════
// OUTIL ORTHOPHONISTE — connexion patient par code (sans compte)
// ═══════════════════════════════════════
exports.getPatientByCode = onCall(
  { region: "europe-west1" },
  async (request) => {
    const orthoCode = String(request.data?.orthoCode || "").trim().toUpperCase();
    const patientCode = String(request.data?.patientCode || "").trim().toUpperCase();
    if (!orthoCode || !patientCode) {
      throw new HttpsError("invalid-argument", "Code cabinet et code patient requis.");
    }

    const orthoSnap = await db.collection("users").where("orthoCode", "==", orthoCode).limit(1).get();
    if (orthoSnap.empty) throw new HttpsError("not-found", "Code cabinet introuvable");
    const orthoId = orthoSnap.docs[0].id;

    const patientSnap = await db.collection("patients")
      .where("orthoId", "==", orthoId)
      .where("code", "==", patientCode)
      .limit(1).get();
    if (patientSnap.empty) throw new HttpsError("not-found", "Code patient introuvable");

    const patientDoc = patientSnap.docs[0];
    const p = patientDoc.data();
    await patientDoc.ref.update({ lastLogin: new Date().toISOString() });

    return {
      patientId: patientDoc.id,
      orthoId,
      name: p.name || "",
      activeApps: p.activeApps || ["calcul", "dictee", "sons", "lecture"],
      activeSons: p.activeSons || [],
      difficulty: p.difficulty || {},
      sessionSequence: p.sessionSequence || [],
      parentNotes: p.parentNotes || "",
      encouragementMessage: p.encouragementMessage || "",
      customWords: p.customWords || "",
      customTextTitle: p.customTextTitle || "",
      customTextBody: p.customTextBody || "",
    };
  }
);

// Envoie l'email d'invitation/bienvenue au calendrier — utilisé pour les tests
// (testEmail = envoyer à soi-même) et pour la vraie invitation d'un membre de la famille.
exports.envoyerInvitationCalendrier = onCall(
  { region: "europe-west1", secrets: [SMTP_PASS] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise");
    const prenom = String(request.data?.prenom || "").trim();
    const email = String(request.data?.email || "").trim();
    const testEmail = request.data?.testEmail ? String(request.data.testEmail).trim() : null;
    const greeting = request.data?.greeting ? String(request.data.greeting).trim() : `Salut ${prenom},`;
    if (!prenom || !email) throw new HttpsError("invalid-argument", "prenom et email requis");

    const template = fs.readFileSync(path.join(__dirname, "email_invite.html"), "utf8");
    const html = template.replaceAll("{{GREETING}}", greeting).replaceAll("{{EMAIL}}", email);

    const mailer = transporter();
    await mailer.sendMail({
      from: `"Calendrier Leoluce" <${SMTP_USER}>`,
      to: testEmail || email,
      subject: testEmail ? `[TEST] 🎂 Bienvenue sur le calendrier familial !` : `🎂 Bienvenue sur le calendrier familial !`,
      html,
    });
    return { ok: true, sentTo: testEmail || email };
  }
);

// Prévisualisation des emails d'alerte (avec de fausses données) — pour valider le design
// avant d'attendre le vrai déclenchement planifié.
exports.previewDigest = onCall(
  { region: "europe-west1", secrets: [SMTP_PASS] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise");
    const type = request.data?.type === "monthly" ? "monthly" : "daily";
    const testEmail = String(request.data?.testEmail || "").trim();
    if (!testEmail) throw new HttpsError("invalid-argument", "testEmail requis");

    const sampleUsersByUid = { fakeuid1: { colorHex: "#4caf50" } };
    const mailer = transporter();

    if (type === "daily") {
      const fake = [
        { firstName: "Léonie", lastName: "", category: "familial", birthYear: 2015 },
        { firstName: "Marraine", lastName: "Sophie", category: "amis_famille" },
      ];
      const template = fs.readFileSync(path.join(__dirname, "email_daily.html"), "utf8");
      const lignes = fake.map(e => renderEmailRow(colorForEntry(e, sampleUsersByUid), escapeHtml(fullName(e)), e.birthYear ? `${new Date().getFullYear() - e.birthYear} ans` : "")).join("");
      const html = template.replaceAll("{{TITRE}}", "Anniversaires du jour").replaceAll("{{PRENOM}}", "Géraldine").replaceAll("{{LIGNES}}", lignes);
      await mailer.sendMail({ from: `"Calendrier Leoluce" <${SMTP_USER}>`, to: testEmail, subject: "[APERÇU] 🎂 Anniversaires du jour", html });
    } else {
      const fake = [
        { day: 3, firstName: "Lucie", lastName: "", category: "familial", alertEnabled: true },
        { day: 14, firstName: "Cousin", lastName: "Marc", category: "enfants_amis", alertEnabled: false },
      ];
      const template = fs.readFileSync(path.join(__dirname, "email_monthly.html"), "utf8");
      const lignes = fake.map(e => renderEmailRow(colorForEntry(e, sampleUsersByUid), escapeHtml(fullName(e)), `${String(e.day).padStart(2, "0")}/08${e.alertEnabled ? "" : " · pas d'alerte"}`)).join("");
      const html = template.replaceAll("{{TITRE}}", "Anniversaires d'août").replaceAll("{{PRENOM}}", "Géraldine").replaceAll("{{LIGNES}}", lignes);
      await mailer.sendMail({ from: `"Calendrier Leoluce" <${SMTP_USER}>`, to: testEmail, subject: "[APERÇU] 📅 Anniversaires du mois prochain", html });
    }
    return { ok: true };
  }
);

exports.dailyBirthdayDigest = onSchedule(
  { schedule: "0 * * * *", timeZone: "Europe/Paris", region: "europe-west1", secrets: [SMTP_PASS] },
  async () => {
    const { day, month, year, hour } = parisParts(new Date());

    const entriesSnap = await db.collection("bdayEntries")
      .where("alertEnabled", "==", true)
      .where("day", "==", day)
      .where("month", "==", month)
      .get();
    if (entriesSnap.empty) return;

    const todays = entriesSnap.docs.map(d => d.data());
    const allUsers = await activeFamilyUsers();
    const bdayUsersByUid = Object.fromEntries(allUsers.map(u => [u.uid, u]));
    const recipients = allUsers.filter(u => u.notifyEnabled !== false && Number(u.preferredHour ?? 7) === hour);
    if (!recipients.length) return;

    const template = fs.readFileSync(path.join(__dirname, "email_daily.html"), "utf8");
    const withAge = todays.map(e => ({ e, age: ageAt(e, year) }));
    const anySpecial = withAge.some(({ e, age }) => isDirectFamily(e) || isMilestoneAge(age));
    const titre = anySpecial
      ? "🎉 Anniversaire exceptionnel aujourd'hui !"
      : (todays.length > 1 ? "Anniversaires du jour" : "Anniversaire du jour");
    const lignes = withAge.map(({ e, age }) => {
      const special = isDirectFamily(e) || isMilestoneAge(age);
      const value = age != null ? `${age} ans${isMilestoneAge(age) ? " !" : ""}` : "";
      return renderEmailRow(colorForEntry(e, bdayUsersByUid), escapeHtml(fullName(e)), value, special);
    }).join("");

    const mailer = transporter();
    for (const u of recipients) {
      const html = template
        .replaceAll("{{TITRE}}", titre)
        .replaceAll("{{PRENOM}}", escapeHtml(u.displayName || ""))
        .replaceAll("{{LIGNES}}", lignes);
      await mailer.sendMail({
        from: `"Calendrier Leoluce" <${SMTP_USER}>`,
        to: u.email,
        subject: anySpecial ? titre : `🎂 ${titre}`,
        html,
        text: `Bonjour ${u.displayName || ""},\n\nAujourd'hui :\n${todays.map(e => `- ${fullName(e)}`).join("\n")}\n\n— Calendrier familial Leoluce`,
      });
    }
  }
);

exports.monthlyBirthdayDigest = onSchedule(
  { schedule: "0 20 * * *", timeZone: "Europe/Paris", region: "europe-west1", secrets: [SMTP_PASS] },
  async () => {
    const { day, month, year } = parisParts(new Date());
    const daysInMonth = new Date(year, month, 0).getDate();
    if (day !== daysInMonth) return; // uniquement le dernier jour du mois

    const nextMonth = month === 12 ? 1 : month + 1;
    const MOIS_NOMS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
    // Tous les anniversaires du mois prochain — ceux sans alerte activée sont juste
    // annotés, pas exclus (utile de tous les voir même si pas de rappel le jour J).
    const entriesSnap = await db.collection("bdayEntries").where("month", "==", nextMonth).get();
    if (entriesSnap.empty) return;

    const sorted = entriesSnap.docs.map(d => d.data()).sort((a, b) => a.day - b.day);
    const allUsers = await activeFamilyUsers();
    const bdayUsersByUid = Object.fromEntries(allUsers.map(u => [u.uid, u]));
    const recipients = allUsers.filter(u => u.monthlyDigestEnabled !== false);
    if (!recipients.length) return;

    const template = fs.readFileSync(path.join(__dirname, "email_monthly.html"), "utf8");
    const titre = `Anniversaires de ${MOIS_NOMS[nextMonth - 1]}`;
    const lignes = sorted.map(e => renderEmailRow(
      colorForEntry(e, bdayUsersByUid),
      escapeHtml(fullName(e)),
      `${String(e.day).padStart(2, "0")}/${String(nextMonth).padStart(2, "0")}${e.alertEnabled ? "" : " · pas d'alerte"}`,
    )).join("");
    const textLines = sorted.map(e => `- ${String(e.day).padStart(2, "0")}/${String(nextMonth).padStart(2, "0")} : ${fullName(e)}${e.alertEnabled ? "" : " (pas d'alerte le jour J)"}`).join("\n");

    const mailer = transporter();
    for (const u of recipients) {
      const html = template
        .replaceAll("{{TITRE}}", titre)
        .replaceAll("{{PRENOM}}", escapeHtml(u.displayName || ""))
        .replaceAll("{{LIGNES}}", lignes);
      await mailer.sendMail({
        from: `"Calendrier Leoluce" <${SMTP_USER}>`,
        to: u.email,
        subject: `📅 ${titre}`,
        html,
        text: `Bonjour ${u.displayName || ""},\n\nÀ venir le mois prochain :\n${textLines}\n\n— Calendrier familial Leoluce`,
      });
    }
  }
);

// ═══════════════════════════════════════
// RÉVISIONS (ex-English Time) — Lucie (collège) et Léonie (CE2), plusieurs matières, accès parent.
// Les collections gardent leur nom historique (*Anglais) ; chaque doc porte `eleve` (uid) et `matiere`.
// ═══════════════════════════════════════
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const PARENT_UID = "GoxalGBKNWcyC6OkdENgz8j1u883";
const LUCIE_UID = "BmPJ62Hhb0V572vQgzwzybbnU8s2";
const RECAP_DESTINATAIRE = "gbornand@gmail.com";
const ELEVES = {
  [LUCIE_UID]: { prenom: "Lucie", niveau: "college", matieres: ["anglais", "maths", "tables", "physique", "svt", "histoire", "francais"] },
  "PKRatKwnzDZt0BzZjMfO3PFnGxU2": { prenom: "Léonie", niveau: "ce2", matieres: ["francais", "dictee", "tables", "maths", "anglais", "histoire"] },
};
const NOMS_MATIERES = { anglais: "anglais", francais: "français", dictee: "dictée", tables: "tables de multiplication", maths: "mathématiques", physique: "physique-chimie", svt: "SVT", histoire: "histoire-géographie" };
const SCIENCES = ["maths", "physique"];
const MATIERES_DOCUMENTS = ["svt", "histoire"];

function contexteAppel(request, { matiereRequise = true } = {}) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Connexion requise.");
  const estParent = uid === PARENT_UID;
  const eleve = estParent ? String(request.data?.eleve || "") : uid;
  const profil = ELEVES[eleve];
  if (!profil) throw new HttpsError("permission-denied", "Accès réservé.");
  const matiere = String(request.data?.matiere || "");
  if (matiereRequise && !profil.matieres.includes(matiere)) throw new HttpsError("invalid-argument", "Matière inconnue.");
  return { eleve, matiere, profil, estParent };
}

function verifierEleve(data, eleve) {
  if (!data || data.eleve !== eleve) throw new HttpsError("permission-denied", "Accès réservé.");
}

function slugAnglais(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function extractJsonAnglais(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new HttpsError("internal", "Réponse IA illisible (pas de JSON).");
  try {
    return JSON.parse(match[0]);
  } catch {
    throw new HttpsError("internal", "Réponse IA illisible (JSON invalide).");
  }
}

function todayISOAnglais() { return new Date().toISOString().slice(0, 10); }

function publicEleve(profil) {
  return profil.niveau === "ce2" ? "une élève française de CE2 (8 ans)" : "une collégienne française";
}

const MATIERES_FIGURES = ["svt", "histoire", "physique"];

function consigneFigures(matiere) {
  if (!MATIERES_FIGURES.includes(matiere)) return "";
  return `

FIGURES : ajoute aussi au JSON une clé "figures" listant les ${matiere === "histoire" ? "cartes et schémas légendés" : "schémas légendés"} présents dans le document (ceux qui ont des étiquettes/légendes à apprendre) :
"figures": [ { "titre": "titre court de la figure", "type": "${matiere === "histoire" ? "carte\" ou \"schema" : "schema"}", "page": numéro de la page du PDF ou de la photo (1 = la première), "legendes": ["texte exact de chaque étiquette ou légende, dans l'ordre de lecture"] } ]
Tableau vide s'il n'y en a aucune. Recopie les légendes telles qu'écrites sur la figure.`;
}

function profDe(matiere) {
  return { anglais: "prof d'anglais", francais: "maîtresse de CE2", dictee: "maîtresse de CE2", maths: "prof de maths", physique: "prof de physique-chimie", svt: "prof de SVT", histoire: "prof d'histoire-géographie" }[matiere];
}

const NOTATION_SCIENCES = "Écris les maths en texte simple avec les symboles Unicode (×, ÷, ², ³, √, π, ≤, ≥, ½, °), jamais de LaTeX. Vérifie chaque calcul deux fois : une réponse fausse dans la correction est inacceptable.";

// Ce que l'IA doit relever dans un cours, selon la matière.
function consigneExtraction(matiere, profil) {
  const schema = (vocab, gram) => `Réponds UNIQUEMENT avec un objet JSON (pas de texte avant/après, pas de markdown) au format exact suivant :
{
  "titre": "titre court du cours",
  "recap": "récapitulatif clair et pédagogique du cours, en français, adapté à ${publicEleve(profil)} (3-8 phrases)",
  "vocabulaire": [ ${vocab} ],
  "grammaire": [ ${gram} ]
}`;
  const commun = `Ne mets que ce qui est réellement présent/déductible dans le document. Si une catégorie est absente, le tableau correspondant peut être vide.`;
  if (matiere === "anglais") {
    return `Tu es un(e) ${profDe(matiere)} qui prépare le travail de ${publicEleve(profil)}. Analyse le cours d'anglais fourni.
${schema(`{ "mot": "mot ou expression en anglais", "traduction": "traduction en français", "theme": "thème court en français", "exemple": "courte phrase d'exemple en anglais" }`,
  `{ "titre": "nom court de la notion de grammaire", "explication": "explication pédagogique en français", "exemples": ["phrase d'exemple en anglais"] }`)}
VOCABULAIRE : sois EXHAUSTIF. Parcours chaque page et relève ABSOLUMENT TOUS les mots et expressions (listes, tableaux, encadrés, lexiques, mots illustrés), sans omettre ni résumer. Plusieurs pages = plusieurs centaines d'entrées, c'est normal. Regroupe par "theme" (titre de rubrique du cours s'il existe). Exemples courts.
${commun}`;
  }
  if (matiere === "dictee") {
    return `Tu es une ${profDe(matiere)} qui prépare le travail de ${publicEleve(profil)}. Le document est une liste de mots à apprendre pour la dictée (ou une dictée corrigée). La photo peut être de travers, pâle ou tournée : lis-la attentivement dans tous les sens.
${schema(`{ "mot": "le mot EXACTEMENT comme écrit sur la liste, avec son déterminant s'il y en a un (ex: 'une bibliothèque', 'l'Afrique', 'menacer'), OU pour une dictée corrigée le mot correctement écrit d'une faute commise", "traduction": "sens très simple en quelques mots (ex: 'endroit où on emprunte des livres')", "theme": "titre court de CETTE liste (ex: 'Le Mali', 'Dictée du 14/11')", "exemple": "", "prioritaire": "true si ce mot est SURLIGNÉ (feutre fluo jaune, vert, rose… : un fond de couleur derrière le mot) ; sinon ne mets pas ce champ" }`, ``)}
Relève TOUS les mots de la liste, sans en omettre, dans l'ordre. Le surlignage fluo est ESSENTIEL : l'élève ne travaille que les mots surlignés. Regarde chaque mot un par un : a-t-il un fond coloré ? Une parenthèse d'aide (ex: '(+ singulier)') n'est pas un mot. "titre" = titre court de la liste, "recap" = "", "grammaire" = []. ${commun}`;
  }
  if (matiere === "francais" && profil.niveau === "ce2") {
    return `Tu es une ${profDe(matiere)} qui prépare le travail de ${publicEleve(profil)}. Analyse la leçon de français fournie (grammaire, conjugaison, orthographe, vocabulaire).
${schema(`{ "mot": "mot de vocabulaire ou terme de la leçon à connaître (ex: 'le sujet', 'l'infinitif')", "traduction": "sens très simple pour une enfant de 8 ans", "theme": "titre court de la leçon", "exemple": "courte phrase d'exemple simple" }`,
  `{ "titre": "nom court de la règle (grammaire, conjugaison, orthographe)", "explication": "explication très simple pour une enfant de 8 ans", "exemples": ["phrase d'exemple"] }`)}
Une règle = une entrée de "grammaire" (sois complète : toutes les règles de la leçon). IMPORTANT : les LISTES DE MOTS DE DICTÉE (mots à apprendre à écrire pour la dictée de la semaine) ne vont PAS ici, elles ont leur propre onglet Dictée : ignore-les totalement. ${commun}`;
  }
  if (matiere === "francais") {
    return `Tu es un(e) ${profDe(matiere)} qui prépare le travail de ${publicEleve(profil)} (niveau collège). Analyse le document de français fourni : ce peut être une leçon de grammaire/orthographe/conjugaison, OU un bilan de lecture (résumé d'une séance sur un texte/roman étudié, à apprendre par cœur), OU une DICTÉE corrigée (fautes d'orthographe/accord sur des mots), OU une ÉVALUATION corrigée (erreurs de compréhension/d'analyse, pas seulement orthographiques), OU un sujet de rédaction.
${schema(`{ "mot": "mot-clé/notion de vocabulaire à retenir (terme grammatical, mot de la leçon, mot important souligné dans un bilan), OU, si c'est une DICTÉE corrigée, le mot CORRECTEMENT écrit d'une faute d'orthographe qu'elle a commise", "traduction": "définition/explication courte, OU pour une faute de dictée : 'Piège : elle a écrit « ... » au lieu de « ... » — <la règle d'orthographe à retenir>'", "theme": "thème court (ex: Bilan séance 3, Vocabulaire du roman), OU un identifiant UNIQUE de cette dictée précise (ex: 'Dictée du 14/11' ou le titre écrit sur la copie) si c'est une faute de dictée — jamais un thème générique qui mélangerait plusieurs dictées", "exemple": "exemple/citation, OU la phrase exacte de la dictée où se trouvait la faute" }`,
  `{ "titre": "nom court de la règle, OU la confusion commise si c'est une erreur d'ÉVALUATION (ex: 'Épithète vs attribut du sujet', 'Adjectif qualificatif vs démonstratif'), OU 'Bilan séance X : <sujet en 3-4 mots>' si c'est un bilan de lecture, OU 'Méthode : la rédaction' si le document donne un sujet de rédaction", "categorie": "une seule valeur EXACTE parmi : Grammaire, Conjugaison, Orthographe, Texte, Méthode", "explication": "l'explication pédagogique de la règle (définition + comment la repérer) — pour une erreur d'évaluation, explique clairement LA DIFFÉRENCE entre ce qu'elle a répondu et la bonne réponse, et la méthode pour ne plus se tromper ; OU le texte intégral du bilan à apprendre par cœur si c'en est un (ne pas le résumer) ; OU les conseils de méthode pour la rédaction", "exemples": ["phrase d'exemple, citation clé, ou courte illustration"] }`)}
Si le document contient un "Bilan" à recopier/apprendre sur un texte ou roman, reproduis-le intégralement (texte complet, pas de résumé) dans une entrée de "grammaire" avec "categorie": "Texte". Si c'est une leçon de grammaire/orthographe/conjugaison, explique la règle et comment la repérer, avec la "categorie" correspondante (une entrée par règle). Si c'est une DICTÉE corrigée (fautes d'orthographe sur des mots isolés, accords, conjugaison dans un texte dicté), relève CHAQUE faute individuellement dans "vocabulaire" avec un thème propre à CETTE dictée, pour qu'elle s'entraîne dessus à l'oral (elle entendra le mot/la phrase et devra l'écrire). Si c'est une ÉVALUATION corrigée (mauvaise réponse à une question d'analyse, de grammaire, de compréhension — pas juste une faute d'orthographe sur un mot), mets CHAQUE erreur dans "grammaire" (PAS dans "vocabulaire" — ça ne se travaille pas en dictée) avec la categorie Grammaire/Orthographe/Conjugaison adaptée, pour qu'elle révise la règle et s'entraîne par des questions (qcm/trou), pas par une dictée audio. Si c'est un sujet de rédaction, ajoute une entrée "Méthode : la rédaction" (categorie "Méthode") avec les conseils donnés (adjectifs variés, éviter les connecteurs répétitifs, structure du récit...) ET ajoute toujours aussi ce conseil, même s'il n'est pas dans le document : faire des phrases courtes (une idée par phrase, éviter d'enchaîner trop de propositions). ${commun}`;
  }
  if (MATIERES_DOCUMENTS.includes(matiere)) {
    const quoi = matiere === "svt"
      ? { savoir: "définitions, mots-clés, organes et leurs rôles", comprendre: "processus, mécanismes, expériences et leurs conclusions" }
      : { savoir: "dates et repères chronologiques, personnages, définitions, lieux et repères géographiques", comprendre: "événements et leurs causes/conséquences, méthodes (lire une carte, analyser un document)" };
    return `Tu es un(e) ${profDe(matiere)} qui prépare le travail de ${publicEleve(profil)}. Analyse le cours de ${NOMS_MATIERES[matiere]} fourni.
${schema(`{ "mot": "terme, date ou repère à connaître", "traduction": "définition ou ce qu'il faut savoir en une phrase simple", "theme": "chapitre ou partie du cours", "exemple": "précision ou exemple court" }`,
  `{ "titre": "nom court de la notion à comprendre", "categorie": "'Méthode' si c'est une méthode/savoir-faire réutilisable toute l'année (ex: lire une carte, analyser un document, démarche scientifique, légender un schéma) ; sinon ne mets pas ce champ (notion propre à ce chapitre)", "explication": "explication simple et structurée", "exemples": ["exemple ou idée clé"] }`)}
Dans "vocabulaire", mets les ${quoi.savoir}. Dans "grammaire", mets les ${quoi.comprendre} — distingue bien les MÉTHODES réutilisables (categorie "Méthode") des notions propres au chapitre (sans categorie). Sois exhaustif pour "vocabulaire", mais regroupe "grammaire" en GRANDES notions plutôt qu'en miettes : maximum 5 à 6 notions "à comprendre" par document, chacune couvrant un point large (si plusieurs petits sous-points parlent du même mécanisme/de la même idée, fusionne-les en une seule notion avec une explication plus complète plutôt que de créer une fiche par sous-point). Mieux vaut peu de notions bien expliquées que beaucoup de notions redondantes.
${commun}`;
  }
  const lois = matiere === "physique" ? "lois, définitions, grandeurs et unités, formules" : "définitions, formules, propriétés et faits à connaître par cœur (tables, unités…)";
  return `Tu es un(e) ${profDe(matiere)} qui prépare le travail de ${publicEleve(profil)}. Analyse le cours de ${NOMS_MATIERES[matiere]} fourni.
${schema(`{ "mot": "terme, formule ou fait à connaître", "traduction": "définition ou signification en une phrase simple", "theme": "chapitre ou partie du cours", "exemple": "exemple concret, éventuellement chiffré" }`,
  `{ "titre": "nom court de la méthode ou du type d'exercice", "explication": "méthode expliquée pas à pas, simplement", "exemples": ["exemple résolu court"] }`)}
Dans "vocabulaire", mets les ${lois}. Dans "grammaire", mets les méthodes et savoir-faire (comment résoudre tel type d'exercice). Sois exhaustif.
${NOTATION_SCIENCES}
${commun}`;
}

// Formats d'exercices et règles de langue, selon matière et niveau.
function formatsExos(matiere, profil) {
  const ce2 = profil.niveau === "ce2";
  const base = `Trois types d'exercices possibles (champ "type") :
- "qcm" : { "type": "qcm", "question": "...", "choix": ["...", "...", "..."], "bonneReponse": 0, "explication": "..." } — 3 ou 4 choix, "bonneReponse" = index 0-based, varie sa position.
- "trou" : { "type": "trou", "question": "consigne", "phrase": "phrase ou calcul avec ___ à la place de la réponse", "reponses": ["réponse attendue", "variante acceptée"], "explication": "..." } — réponse courte (1 à 3 mots ou un nombre), mets toutes les variantes correctes.
- "ordre" : { "type": "ordre", "question": "consigne", "mots": ["éléments", "mélangés"], "reponse": "la suite correcte, éléments séparés par un espace", "explication": "..." } — 3 à 9 éléments, vraiment mélangés.
"explication" = une phrase courte en français qui explique la bonne réponse.`;
  if (matiere === "anglais" && !ce2) {
    return `${base}
LANGUE : tout ce que l'élève lit pour répondre (question, phrase, choix, mots) est EN ANGLAIS simple, niveau collège. Exception : une question peut demander la traduction d'un mot français vers l'anglais. Seule "explication" est en français. Pour "trou", inclus les formes contractées en variantes. Pour "ordre", les éléments sont des mots sans ponctuation finale.`;
  }
  if (matiere === "anglais" && ce2) {
    return `${base}
LANGUE : consignes en FRANÇAIS très simple (8 ans). Contenu anglais très court : mots isolés ou phrases de 3 à 5 mots. Privilégie "qcm" (images mentales, couleurs, animaux, nombres…). Explications en français, une phrase.`;
  }
  if (matiere === "francais" && ce2) {
    return `${base}
LANGUE : tout en français, phrases TRÈS courtes (5 à 10 mots) et simples, vocabulaire concret, adapté à une enfant de 8 ans dyslexique — une seule idée par question, jamais de phrase à rallonge. Privilégie "qcm" (3 choix maximum, peu de texte à lire) dès que possible. Réserve "trou" aux mots à écrire (un seul mot ou une courte expression, jamais une phrase entière à recopier). Pour "ordre", 3 à 5 éléments maximum (les mots d'une phrase courte).
Pour une règle de grammaire (ex: le sujet du verbe) : reste collée à la leçon, varie les sujets et les verbes d'un exercice à l'autre (pas toujours le même exemple), et réutilise si possible les mots de vocabulaire/dictée du moment dans les phrases d'exercice plutôt que d'inventer un contexte sans lien avec son travail.`;
  }
  if (matiere === "francais") {
    return `${base}
LANGUE : tout en français, niveau collège. Pour un bilan de lecture, utilise "trou" pour faire retrouver les mots-clés importants du texte (teste la mémorisation par cœur du bilan) et "qcm" pour des questions de compréhension. Pour une règle de grammaire/orthographe, utilise "qcm" (identifier la fonction/nature d'un mot dans une phrase) et "trou" (compléter l'accord ou la règle). Pour "ordre", remets dans l'ordre les mots d'une phrase ou les étapes d'une méthode.`;
  }
  if (MATIERES_DOCUMENTS.includes(matiere)) {
    return `${base}
LANGUE : tout en français, ${ce2 ? "très simple, niveau CE2 (8 ans)" : "niveau collège"}. Pour "trou", la réponse est un mot-clé, une date ou un lieu (mets les variantes d'écriture). Pour "ordre", fais remettre dans l'ordre ${matiere === "histoire" ? "des événements chronologiques (éléments = événements courts ou dates)" : "les étapes d'un processus"} : dans ce cas, chaque élément peut faire plusieurs mots — sépare-les dans "reponse" par " | " et mets ces mêmes éléments dans "mots".`;
  }
  return `${base}
LANGUE : tout en français, ${ce2 ? "très simple, niveau CE2 (8 ans), nombres adaptés à cet âge" : "niveau collège"}. Pour les calculs, utilise "trou" avec une réponse numérique : mets les variantes "12", "12,0", "12.0" (et avec l'unité si la consigne la demande). Pour "ordre", fais ranger des nombres ou remettre dans l'ordre les étapes d'une méthode.
${NOTATION_SCIENCES}`;
}

function blocDecouverte(matiere, profil) {
  const ce2 = profil.niveau === "ce2";
  if (matiere === "anglais") {
    return `"comprehensionEcrite": { "mode": "ecoute", "titre": "Écoute & compréhension", "texte": "${ce2 ? "3 ou 4 phrases anglaises très simples" : "court texte en anglais (5-8 phrases), amusant"}, qui réutilise le vocabulaire ci-dessus", "questions": [ 3 questions "qcm" ${ce2 ? "en français" : "in English"} ] }`;
  }
  if (ce2) {
    return `"comprehensionEcrite": null`;
  }
  if (matiere === "francais") {
    return `"comprehensionEcrite": { "mode": "lecture", "titre": "Lecture", "texte": "court extrait ou mini-question de compréhension (4-8 phrases), niveau collège, en lien avec le bilan de lecture ou la notion de grammaire ci-dessus", "questions": [ 3 questions "qcm" ou "trou" ] }`;
  }
  if (MATIERES_DOCUMENTS.includes(matiere)) {
    return `"comprehensionEcrite": { "mode": "lecture", "titre": "${matiere === "svt" ? "Document scientifique" : "Document"}", "texte": "court document (4-6 phrases) ${matiere === "svt" ? "décrivant une observation ou une expérience" : "racontant un événement ou décrivant un lieu"}, ${ce2 ? "niveau CE2" : "niveau collège"}, en lien avec les notions ci-dessus", "questions": [ 3 questions "qcm" ou "trou" sur le document ] }`;
  }
  return `"comprehensionEcrite": { "mode": "probleme", "titre": "${matiere === "physique" ? "Situation" : "Problème"}", "texte": "${matiere === "physique" ? "petite situation concrète ou expérience" : "petit problème concret de la vie quotidienne"} en 3-5 phrases, ${ce2 ? "niveau CE2" : "niveau collège"}, qui mobilise les notions ci-dessus", "questions": [ 2 ou 3 questions "qcm" ou "trou" (réponse numérique) ] }`;
}

function ligneNotion(n, cours) {
  if (n.type === "vocabulaire") {
    const v = (cours?.vocabulaire || []).find(x => x.mot === n.label);
    return `- [id:${n.id}] À SAVOIR "${n.label}"${v ? ` = ${v.traduction}${v.exemple ? ` (ex: ${v.exemple})` : ""}` : ""}`;
  }
  const g = (cours?.grammaire || []).find(x => x.titre === n.label);
  const etiquette = n.categorie === "Texte" ? "BILAN À RETENIR" : n.categorie ? n.categorie.toUpperCase()
    : ["anglais", "francais"].includes(n.matiere) ? "RÈGLE" : SCIENCES.includes(n.matiere) ? "MÉTHODE" : "À COMPRENDRE";
  return `- [id:${n.id}] ${etiquette} "${n.label}"${g ? ` : ${g.explication}` : ""}`;
}

function reparateurIds(notions) {
  const ids = new Set(notions.map(n => n.id));
  return brut => {
    const s = String(brut || "").replace(/^\[?\s*id\s*:\s*/i, "").replace(/\]$/, "").trim();
    return ids.has(s) ? s : (notions.find(n => s && (s.includes(n.id) || n.id.includes(s)))?.id || null);
  };
}

// Effort réduit pour aller vite (téléphone) ; un peu plus de réflexion en maths/physique pour la justesse des calculs.
function effortPour(matiere) { return SCIENCES.includes(matiere) || matiere === "francais" ? "medium" : "low"; }

async function appelIA(prompt, maxTokens = 8000, effort = "low") {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: maxTokens,
    output_config: { effort },
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = response.content.find(b => b.type === "text");
  if (!textBlock) throw new HttpsError("internal", "Réponse IA vide.");
  return extractJsonAnglais(textBlock.text);
}

// Pour chaque mot d'une dictée : syllabes (couleurs dys), pièges d'orthographe, fausses écritures, sens, phrase.
async function preparerMotsDictee(vocabulaire) {
  const mots = (vocabulaire || []).map(v => v.mot).filter(Boolean);
  if (!mots.length) return {};
  const prompt = `Tu es une maîtresse de CE2 spécialisée dans l'aide aux enfants dyslexiques. Pour chacun de ces mots à apprendre pour la dictée, prépare le matériel d'apprentissage.
Mots (avec leur déterminant éventuel) :
${mots.map(m => `- ${m}`).join("\n")}

Réponds UNIQUEMENT avec un objet JSON (pas de texte avant/après, pas de markdown) :
{ "mots": [ {
  "mot": "le mot EXACTEMENT tel que donné ci-dessus",
  "syllabes": ["découpage en syllabes ÉCRITES, tel qu'on l'apprend à l'école pour lire", "..."],
  "pieges": "le mot exactement tel que donné, avec chaque difficulté d'orthographe entre crochets",
  "erreurs": ["une écriture fausse mais plausible à l'oreille", "une autre écriture fausse plausible"],
  "sens": "sens en 3 à 8 mots, pour une enfant de 8 ans",
  "phrase": "phrase de dictée très courte (4 à 7 mots), simple, qui contient le mot tel quel"
} ] }

Règles :
- "syllabes" : le déterminant (le, la, l', un, une…) est un élément à part, en premier. Les syllabes collées doivent redonner exactement le mot (même lettres, mêmes accents, même apostrophe ; les espaces ne comptent pas). Ex : "une bibliothèque" → ["une", "bi", "blio", "thèque"] ; "l'Afrique" → ["l'", "A", "fri", "que"].
- "pieges" : entoure de crochets les lettres où un enfant se trompe : lettres muettes (le t de « désert »), doubles consonnes, ç, s/ss, c/qu/k, g/ge/gu, accents, h muet, ph/th, an/en, ain/ein, terminaisons pièges (-tion, -ée, -eau…). Seulement les vraies difficultés (1 à 3 par mot). Sans les crochets, le texte doit être EXACTEMENT le mot. Ex : "une biblio[th]è[qu]e", "un ma[ç]on", "une a[nn][ée]", "le déser[t]".
- "erreurs" : deux fautes que fait vraiment un enfant (qui se prononcent pareil), jamais identiques au mot, avec le même déterminant. Ex : "un maçon" → ["un masson", "un maçont"].`;
  const parsed = await appelIA(prompt, 12000, "low");
  const sansEspaces = s => String(s || "").replace(/\s+/g, "");
  const prepa = {};
  for (const p of parsed.mots || []) {
    if (!mots.includes(p.mot)) continue;
    const syllabes = Array.isArray(p.syllabes) && sansEspaces(p.syllabes.join("")) === sansEspaces(p.mot) ? p.syllabes.map(String) : null;
    const pieges = String(p.pieges || "").replace(/[[\]]/g, "") === p.mot ? String(p.pieges) : null;
    const erreurs = (Array.isArray(p.erreurs) ? p.erreurs : []).map(String).filter(e => e && e !== p.mot).slice(0, 2);
    prepa[p.mot] = { syllabes, pieges, erreurs, sens: String(p.sens || ""), phrase: String(p.phrase || "") };
  }
  return prepa;
}

exports.preparerDictee = onCall(
  { region: "europe-west1", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 180, invoker: "public" },
  async (request) => {
    const { eleve } = contexteAppel(request, { matiereRequise: false });
    const ref = db.collection("coursAnglais").doc(String(request.data?.coursId || ""));
    const snap = await ref.get();
    verifierEleve(snap.data(), eleve);
    if (snap.data().matiere !== "dictee") throw new HttpsError("invalid-argument", "Ce n'est pas une dictée.");
    const prepa = await preparerMotsDictee(snap.data().vocabulaire);
    await ref.update({ prepa });
    return { prepa };
  }
);

async function vocabAnglaisConnu(eleve) {
  const snap = await db.collection("coursAnglais").where("eleve", "==", eleve).get();
  return [...new Set(snap.docs.filter(d => d.data().matiere === "anglais").flatMap(d => (d.data().vocabulaire || []).map(v => v.mot)))];
}

// Profil de l'utilisateur connecté + migration unique des données d'avant le multi-élèves (tout = Lucie, anglais).
exports.initialiserRevisions = onCall(
  { region: "europe-west1", invoker: "public", timeoutSeconds: 300 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Connexion requise.");
    const estParent = uid === PARENT_UID;
    if (!estParent && !ELEVES[uid]) throw new HttpsError("permission-denied", "Accès réservé.");

    const migRef = db.collection("revisionsMeta").doc("migrationV2");
    if (!(await migRef.get()).exists) {
      for (const nom of ["coursAnglais", "progressionAnglais", "seancesAnglais", "reponsesAnglais", "chansonsAnglais"]) {
        const snap = await db.collection(nom).get();
        const aMigrer = snap.docs.filter(d => !d.data().eleve);
        for (let i = 0; i < aMigrer.length; i += 400) {
          const batch = db.batch();
          aMigrer.slice(i, i + 400).forEach(d => batch.update(d.ref, { eleve: LUCIE_UID, matiere: d.data().matiere || "anglais" }));
          await batch.commit();
        }
      }
      await migRef.set({ faitLe: new Date().toISOString() });
    }

    const liste = (estParent ? Object.keys(ELEVES) : [uid]).map(id => ({ uid: id, ...ELEVES[id] }));
    return { role: estParent ? "parent" : "eleve", eleves: liste };
  }
);

// Reçoit photos/PDF d'un cours, les fait analyser selon la matière, stocke le cours et crée une
// fiche de suivi (répétition espacée) par notion, due dès aujourd'hui.
exports.extraireCoursAnglais = onCall(
  { region: "europe-west1", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 900, memory: "512MiB" },
  async (request) => {
    const { eleve, matiere, profil } = contexteAppel(request);
    const images = Array.isArray(request.data?.images) ? request.data.images : [];
    const content = images
      .filter(img => img?.data && img?.mimeType)
      .map(img => img.mimeType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: img.data } }
        : { type: "image", source: { type: "base64", media_type: img.mimeType, data: img.data } });
    if (!content.length) throw new HttpsError("invalid-argument", "Au moins une photo valide est requise.");
    content.push({ type: "text", text: consigneExtraction(matiere, profil) + consigneFigures(matiere) });

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 64000,
      messages: [{ role: "user", content }],
    }).finalMessage();
    if (response.stop_reason === "max_tokens") {
      throw new HttpsError("resource-exhausted", "Cours trop long pour un seul envoi : découpe-le en plusieurs parties.");
    }
    const textBlock = response.content.find(b => b.type === "text");
    if (!textBlock) throw new HttpsError("internal", "Réponse IA vide.");
    const parsed = extractJsonAnglais(textBlock.text);
    let prepa = null;
    if (matiere === "dictee") {
      parsed.grammaire = [];
      try { prepa = await preparerMotsDictee(parsed.vocabulaire); } catch (err) { console.error("Préparation dictée", err); }
    }

    const docRef = await db.collection("coursAnglais").add({
      eleve, matiere,
      ...(prepa ? { prepa } : {}),
      titre: parsed.titre || `Cours de ${NOMS_MATIERES[matiere]}`,
      recap: parsed.recap || "",
      vocabulaire: parsed.vocabulaire || [],
      grammaire: parsed.grammaire || [],
      figuresProposees: Array.isArray(parsed.figures) ? parsed.figures.slice(0, 20) : [],
      dateAjout: new Date().toISOString(),
    });

    const today = todayISOAnglais();
    const base = { eleve, matiere, coursId: docRef.id, niveau: 0, dernierResultat: null, prochaineDate: today, dernierVu: null };
    const ecritures = [
      ...(parsed.vocabulaire || []).map(v => [`vocab_${docRef.id}_${slugAnglais(v.mot)}`, { ...base, type: "vocabulaire", label: v.mot, theme: v.theme || "", ...(v.prioritaire ? { prioritaire: true } : {}) }]),
      ...(parsed.grammaire || []).map(g => [`gram_${docRef.id}_${slugAnglais(g.titre)}`, { ...base, type: "grammaire", label: g.titre, ...(g.categorie ? { categorie: g.categorie } : {}) }]),
    ];
    for (let i = 0; i < ecritures.length; i += 400) {
      const batch = db.batch();
      for (const [id, data] of ecritures.slice(i, i + 400)) {
        batch.set(db.collection("progressionAnglais").doc(id), data, { merge: true });
      }
      await batch.commit();
    }

    return { coursId: docRef.id, titre: parsed.titre, vocabulaire: parsed.vocabulaire || [], grammaire: parsed.grammaire || [], figures: Array.isArray(parsed.figures) ? parsed.figures.slice(0, 20) : [] };
  }
);

// Localise sur une page de cours le cadre d'une figure et le texte de chacune de ses légendes
// (coordonnées en millièmes de l'image), pour fabriquer automatiquement le schéma vierge.
exports.localiserFigureRevisions = onCall(
  { region: "europe-west1", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120, memory: "512MiB", invoker: "public" },
  async (request) => {
    contexteAppel(request, { matiereRequise: false });
    const image = String(request.data?.image || "");
    const titre = String(request.data?.titre || "").slice(0, 120);
    const legendes = (Array.isArray(request.data?.legendes) ? request.data.legendes : []).map(String).slice(0, 40);
    if (!image) throw new HttpsError("invalid-argument", "Image requise.");

    const prompt = `Cette image est une page de cours. Elle contient la figure « ${titre || "schéma"} »${legendes.length ? ` avec ces légendes : ${legendes.map(l => `« ${l} »`).join(", ")}` : ""}.
1. Donne la boîte englobante de la figure entière, légendes comprises.
2. Pour CHAQUE légende, donne la boîte englobante serrée du TEXTE de la légende tel qu'il est écrit sur l'image (pas le trait ni la zone pointée).${legendes.length ? "" : " Relève toi-même les légendes de la figure."}
3. Indique "rotation" : l'angle (0, 90, 180 ou 270) dont il faut tourner l'image dans le sens des aiguilles d'une montre pour que le texte de la figure se lise à l'endroit (0 si elle est déjà droite).
Coordonnées en millièmes de la largeur et de la hauteur de l'image TELLE QU'ELLE EST FOURNIE, sans la tourner (entiers de 0 à 1000), origine en haut à gauche. Sois précis.
Réponds UNIQUEMENT avec un objet JSON (pas de texte avant/après, pas de markdown) :
{ "rotation": 0, "figure": { "x0": 0, "y0": 0, "x1": 1000, "y1": 1000 }, "legendes": [ { "texte": "...", "x0": 0, "y0": 0, "x1": 0, "y1": 0 } ] }
Omets une légende qui n'est pas visible.`;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
        { type: "text", text: prompt },
      ] }],
    });
    const textBlock = response.content.find(b => b.type === "text");
    if (!textBlock) throw new HttpsError("internal", "Réponse IA vide.");
    const r = extractJsonAnglais(textBlock.text);
    const boite = b => {
      const v = ["x0", "y0", "x1", "y1"].map(k => Math.min(1000, Math.max(0, Number(b?.[k]) || 0)));
      return { x0: Math.min(v[0], v[2]), y0: Math.min(v[1], v[3]), x1: Math.max(v[0], v[2]), y1: Math.max(v[1], v[3]) };
    };
    const rotation = [0, 90, 180, 270].includes(Number(r.rotation)) ? Number(r.rotation) : 0;
    return {
      rotation,
      figure: boite(r.figure),
      legendes: (r.legendes || []).filter(l => l?.texte).map(l => ({ texte: String(l.texte), ...boite(l) }))
        .filter(l => l.x1 - l.x0 > 2 && l.y1 - l.y0 > 2),
    };
  }
);

// Exercices à la demande sur une seule notion (depuis « Mes notions ») — non stockés.
exports.exercicesNotionAnglais = onCall(
  { region: "europe-west1", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120 },
  async (request) => {
    const { eleve, profil } = contexteAppel(request, { matiereRequise: false });
    const notionId = String(request.data?.notionId || "");
    const notionSnap = await db.collection("progressionAnglais").doc(notionId).get();
    if (!notionSnap.exists) throw new HttpsError("not-found", "Notion introuvable.");
    const notion = { id: notionSnap.id, ...notionSnap.data() };
    verifierEleve(notion, eleve);
    const coursSnap = await db.collection("coursAnglais").doc(notion.coursId).get();
    const cours = coursSnap.exists ? coursSnap.data() : {};
    const matiere = notion.matiere || "anglais";

    const prompt = `Tu es un(e) ${profDe(matiere)} ludique. ${publicEleve(profil)} veut s'entraîner sur cette notion précise de ${NOMS_MATIERES[matiere]} :
${ligneNotion(notion, cours)}${notion.type === "grammaire" ? `\nExemples du cours : ${((cours.grammaire || []).find(x => x.titre === notion.label)?.exemples || []).join(" / ")}` : ""}

Génère 5 exercices progressifs (du plus simple au plus exigeant) uniquement sur cette notion, en mélangant les types.
${matiere === "anglais" ? `Vocabulaire autorisé : celui du cours (${(cours.vocabulaire || []).map(v => v.mot).join(", ")}) et des mots anglais très basiques. Aucun mot nouveau ou rare, y compris dans les mauvaises réponses.` : ""}

${formatsExos(matiere, profil)}

Réponds UNIQUEMENT avec un objet JSON (pas de texte avant/après, pas de markdown) : { "exercices": [ ... ] }`;
    const parsed = await appelIA(prompt, 4096, effortPour(matiere));
    return { exercices: parsed.exercices || [] };
  }
);

// Fiche pédagogique d'une chanson (anglais). Les paroles éventuelles sont collées par l'utilisateur ;
// l'IA ne les reproduit ni ne les traduit intégralement.
exports.ficheChansonAnglais = onCall(
  { region: "europe-west1", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 180, invoker: "public" },
  async (request) => {
    const { eleve, profil } = contexteAppel(request, { matiereRequise: false });
    const id = String(request.data?.id || "").trim();
    const youtubeId = String(request.data?.youtubeId || "").trim();
    const paroles = typeof request.data?.paroles === "string" ? request.data.paroles.replace(/\r/g, "").trim().slice(0, 20000) : null;
    if (youtubeId && !/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) throw new HttpsError("invalid-argument", "Lien YouTube invalide.");
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    if (id) {
      const ref = db.collection("chansonsAnglais").doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw new HttpsError("not-found", "Chanson introuvable.");
      verifierEleve(snap.data(), eleve);
      const maj = {};
      if (request.data?.youtubeId !== undefined) maj.youtubeId = youtubeId;
      if (paroles !== null) {
        maj.paroles = paroles;
        maj.annotations = paroles ? await annoterParolesAnglais(client, snap.data().titre, paroles, profil) : [];
      }
      await ref.update(maj);
      return { id };
    }

    const titre = String(request.data?.titre || "").trim().slice(0, 120);
    const artiste = String(request.data?.artiste || "").trim().slice(0, 120);
    if (!titre) throw new HttpsError("invalid-argument", "Titre requis.");

    const prompt = `Tu es un(e) prof d'anglais ludique. ${publicEleve(profil)} veut travailler son anglais avec la chanson « ${titre} »${artiste ? ` de ${artiste}` : ""}.

Prépare une fiche d'étude. CONTRAINTE ABSOLUE (droits d'auteur) : ne reproduis PAS les paroles. Pas de couplet, pas de refrain, pas de vers complet. Tu peux seulement citer des expressions isolées de 2 à 5 mots maximum.

Réponds UNIQUEMENT avec un objet JSON (pas de texte avant/après, pas de markdown) :
{
  "connue": true,
  "resume": "de quoi parle la chanson, en français, 3-4 phrases, ton sympa",
  "contexte": "1-2 phrases en français sur l'artiste/l'époque, si utile",
  "expressions": [ { "expression": "expression anglaise courte (2-5 mots) entendue dans la chanson", "sens": "traduction en français", "explication": "explication courte en français (grammaire ou usage)" } ],
  "questions": [ { "type": "qcm", "question": "${profil.niveau === "ce2" ? "question en français simple" : "question EN ANGLAIS"} sur le sens ou les thèmes de la chanson", "choix": ["...", "...", "..."], "bonneReponse": 0, "explication": "phrase courte en français" } ]
}
6 à 8 expressions utiles, 4 questions. Si tu ne connais pas cette chanson avec certitude, renvoie { "connue": false } et rien d'autre.`;
    const response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find(b => b.type === "text");
    if (!textBlock) throw new HttpsError("internal", "Réponse IA vide.");
    const fiche = extractJsonAnglais(textBlock.text);
    if (fiche.connue === false && !paroles) throw new HttpsError("not-found", "La prof IA ne connaît pas assez cette chanson pour faire une fiche fiable.");

    const docRef = await db.collection("chansonsAnglais").add({
      eleve, matiere: "anglais",
      titre, artiste, youtubeId,
      resume: fiche.resume || "", contexte: fiche.contexte || "",
      expressions: fiche.expressions || [], questions: fiche.questions || [],
      paroles: paroles || "",
      annotations: paroles ? await annoterParolesAnglais(client, titre, paroles, profil) : [],
      dateAjout: new Date().toISOString(),
    });
    return { id: docRef.id };
  }
);

// Traduction d'un mot anglais au clic — mise en cache par mot, partagée par la famille.
exports.traduireMotAnglais = onCall(
  { region: "europe-west1", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60, invoker: "public" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid || (uid !== PARENT_UID && !ELEVES[uid])) throw new HttpsError("permission-denied", "Accès réservé.");
    const mot = String(request.data?.mot || "").trim().toLowerCase().replace(/’/g, "'").slice(0, 40);
    const contexte = String(request.data?.contexte || "").trim().slice(0, 200);
    if (!/^[a-z][a-z'-]*$/.test(mot)) throw new HttpsError("invalid-argument", "Mot invalide.");
    const cacheRef = db.collection("motsAnglais").doc(slugAnglais(mot) || "x");
    const cache = await cacheRef.get();
    if (cache.exists) return cache.data();

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 1024,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: `Mot anglais : « ${mot} »${contexte ? `, rencontré dans : « ${contexte} »` : ""}.
Pour une élève française, réponds UNIQUEMENT avec un objet JSON (pas de texte avant/après, pas de markdown) :
{ "traduction": "1 à 3 traductions françaises courtes, la plus courante d'abord", "nature": "nom, verbe, adjectif, adverbe, préposition, pronom…", "base": "si le mot est une forme conjuguée ou un pluriel, la forme de base (ex: went → go), sinon vide", "note": "une remarque utile très courte, ou vide" }` }],
    });
    const textBlock = response.content.find(b => b.type === "text");
    if (!textBlock) throw new HttpsError("internal", "Réponse IA vide.");
    const r = extractJsonAnglais(textBlock.text);
    const resultat = { mot, traduction: String(r.traduction || ""), nature: String(r.nature || ""), base: String(r.base || ""), note: String(r.note || "") };
    await cacheRef.set(resultat);
    return resultat;
  }
);

// Annote des paroles FOURNIES PAR L'UTILISATEUR : expressions courtes repérées ligne par ligne,
// sans traduction intégrale des vers (droits d'auteur).
async function annoterParolesAnglais(client, titre, paroles, profil) {
  const lignes = paroles.split("\n");
  const numerotees = lignes.map((l, i) => `${i}: ${l}`).join("\n");
  const prompt = `Tu es un(e) prof d'anglais pour ${publicEleve(profil)}. Voici les paroles de « ${titre} » collées par l'élève, lignes numérotées :

${numerotees}

Repère 8 à 15 passages utiles à apprendre (expressions idiomatiques, phrasal verbs, temps de grammaire, mots clés). Pour chacun, donne le numéro de ligne et l'expression EXACTE copiée telle quelle depuis cette ligne (2 à 5 mots maximum).
N'écris PAS de traduction des lignes entières : seulement le sens de l'expression courte et une explication.

Réponds UNIQUEMENT avec un objet JSON (pas de texte avant/après, pas de markdown) :
{ "annotations": [ { "ligne": 0, "expression": "...", "sens": "sens en français de l'expression", "explication": "phrase courte en français : grammaire, usage ou truc à retenir" } ] }`;
  const response = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = response.content.find(b => b.type === "text");
  if (!textBlock) return [];
  const { annotations = [] } = extractJsonAnglais(textBlock.text);
  return annotations
    .filter(a => Number.isInteger(a.ligne) && lignes[a.ligne] && a.expression
      && lignes[a.ligne].toLowerCase().includes(String(a.expression).toLowerCase())
      && String(a.expression).split(/\s+/).length <= 6)
    .map(a => ({ ligne: a.ligne, expression: String(a.expression), sens: String(a.sens || ""), explication: String(a.explication || "") }));
}

// Contrôle blanc sur un cours précis : un exercice par notion, les plus faibles d'abord.
exports.controleCoursAnglais = onCall(
  { region: "europe-west1", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 240, invoker: "public" },
  async (request) => {
    const { eleve, profil } = contexteAppel(request, { matiereRequise: false });
    const coursId = String(request.data?.coursId || "");
    const coursSnap = await db.collection("coursAnglais").doc(coursId).get();
    if (!coursSnap.exists) throw new HttpsError("not-found", "Cours introuvable.");
    const cours = coursSnap.data();
    verifierEleve(cours, eleve);
    const matiere = cours.matiere || "anglais";
    const nbQuestions = profil.niveau === "ce2" ? 10 : 15;
    const progSnap = await db.collection("progressionAnglais").where("coursId", "==", coursId).get();
    const toutes = progSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(n => n.eleve === eleve);
    const faibles = (a, b) => (b.dernierResultat === false) - (a.dernierResultat === false) || (a.niveau || 0) - (b.niveau || 0) || Math.random() - .5;
    const gram = toutes.filter(n => n.type === "grammaire").sort(faibles);
    const vocab = toutes.filter(n => n.type === "vocabulaire").sort(faibles);
    const nbGram = Math.min(gram.length, Math.ceil(nbQuestions / 2));
    const notions = [...gram.slice(0, nbGram), ...vocab.slice(0, nbQuestions - nbGram)];

    const prompt = `Tu es un(e) ${profDe(matiere)} qui prépare un CONTRÔLE BLANC pour ${publicEleve(profil)}, sur le cours de ${NOMS_MATIERES[matiere]} « ${cours.titre} ». Notions à évaluer :
${notions.map(n => ligneNotion(n, cours)).join("\n")}
${matiere === "anglais" ? `\nVocabulaire autorisé : celui du cours (${(cours.vocabulaire || []).map(v => v.mot).join(", ")}) + mots anglais très basiques.` : ""}
Génère exactement un exercice par notion ci-dessus, du plus simple au plus difficile, au niveau d'une vraie interro.

${formatsExos(matiere, profil)}

Chaque exercice a en plus "notionId" = l'id exact donné ci-dessus. Réponds UNIQUEMENT avec un objet JSON : { "exercices": [ ... ] }`;
    const { exercices = [] } = await appelIA(prompt, 8000, effortPour(matiere));
    const reparer = reparateurIds(notions);
    return { titre: cours.titre, exercices: exercices.map(e => ({ ...e, notionId: reparer(e.notionId) })) };
  }
);

// Récap hebdomadaire envoyé au parent : une partie par enfant, une ligne par matière.
async function construireRecapEleve(eleve) {
  const depuis = new Date(Date.now() - 7 * 86400000).toISOString();
  const [repSnap, seanceSnap, progSnap] = await Promise.all([
    db.collection("reponsesAnglais").where("eleve", "==", eleve).get(),
    db.collection("seancesAnglais").where("eleve", "==", eleve).get(),
    db.collection("progressionAnglais").where("eleve", "==", eleve).get(),
  ]);
  const reponses = repSnap.docs.map(d => d.data()).filter(r => r.at >= depuis);
  const seances = seanceSnap.docs.map(d => d.data()).filter(s => (s.finieLe || "") >= depuis);
  const progression = progSnap.docs.map(d => d.data());
  const jours = [...new Set(reponses.map(r => r.date))].sort();
  let minutes = 0;
  for (const j of jours) {
    const heures = reponses.filter(r => r.date === j).map(r => Date.parse(r.at)).sort((a, b) => a - b);
    minutes += Math.min(90, Math.max(2, Math.round((heures[heures.length - 1] - heures[0]) / 60000)));
  }
  const bonnes = reponses.filter(r => r.correct).length;
  const parMatiere = ELEVES[eleve].matieres.map(m => {
    const rep = reponses.filter(r => (r.matiere || "anglais") === m);
    const prog = progression.filter(n => (n.matiere || "anglais") === m);
    return {
      matiere: m, reponses: rep.length,
      reussite: rep.length ? Math.round(rep.filter(r => r.correct).length / rep.length * 100) : null,
      maitrisees: prog.filter(n => (n.niveau || 0) >= 4).length, total: prog.length,
      coincent: prog.filter(n => n.dernierResultat === false).map(n => n.label).slice(0, 6),
    };
  });
  return {
    prenom: ELEVES[eleve].prenom, joursActifs: jours.length, minutes, reponses: reponses.length,
    reussite: reponses.length ? Math.round(bonnes / reponses.length * 100) : 0,
    seances: seances.filter(s => !s.type || s.type === "jour").length, parMatiere,
  };
}

function htmlRecapRevisions(recaps) {
  const sections = recaps.map(r => `
    <div style="padding:20px 24px;border-top:1px solid #eee;">
      <div style="font-size:19px;font-weight:900;color:#2d2a4a;">${escapeHtml(r.prenom)} · ${r.joursActifs} jour${r.joursActifs > 1 ? "s" : ""} sur 7</div>
      <div style="color:#6a6690;font-size:14px;margin-top:4px;">≈ ${r.minutes} min · ${r.seances} séance${r.seances > 1 ? "s" : ""} terminée${r.seances > 1 ? "s" : ""} · ${r.reponses} réponses (${r.reussite} % justes)</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px;">
        ${r.parMatiere.map(m => `<tr>
          <td style="padding:7px 0;border-bottom:1px solid #f1eefc;font-weight:800;color:#5b6ee8;text-transform:capitalize;">${NOMS_MATIERES[m.matiere]}</td>
          <td style="padding:7px 0;border-bottom:1px solid #f1eefc;color:#2d2a4a;">${m.reponses ? `${m.reponses} rép. · ${m.reussite} %` : "pas travaillé"}</td>
          <td style="padding:7px 0;border-bottom:1px solid #f1eefc;text-align:right;color:#6a6690;">${m.maitrisees}/${m.total} maîtrisées</td>
        </tr>${m.coincent.length ? `<tr><td colspan="3" style="padding:2px 0 8px;font-size:12px;color:#c0392b;">À reprendre : ${m.coincent.map(escapeHtml).join(" · ")}</td></tr>` : ""}`).join("")}
      </table>
    </div>`).join("");
  return `<div style="font-family:Segoe UI,Arial,sans-serif;background:#f4f0ff;padding:24px;">
  <div style="max-width:560px;margin:auto;background:#fff;border-radius:20px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#5b6ee8,#a152d6);color:#fff;padding:22px 24px;">
      <div style="font-size:13px;opacity:.85;">🦉 Mes révisions · récap de la semaine</div>
      <div style="font-size:22px;font-weight:900;margin-top:4px;">${recaps.map(r => escapeHtml(r.prenom)).join(" & ")}</div>
    </div>
    ${sections}
    <div style="padding:18px 24px 24px;"><a href="https://anglais-leoluce.web.app" style="display:inline-block;background:#5b6ee8;color:#fff;text-decoration:none;font-weight:800;padding:12px 20px;border-radius:999px;">Ouvrir Mes révisions</a></div>
  </div></div>`;
}

async function envoyerRecapRevisions(sujetPrefixe = "") {
  const recaps = await Promise.all(Object.keys(ELEVES).map(construireRecapEleve));
  await transporter().sendMail({
    from: `"Mes révisions" <${SMTP_USER}>`,
    to: RECAP_DESTINATAIRE,
    subject: `${sujetPrefixe}🦉 Révisions de la semaine : ${recaps.map(r => `${r.prenom} ${r.joursActifs}/7 j`).join(", ")}`,
    html: htmlRecapRevisions(recaps),
  });
  return recaps;
}

exports.recapAnglaisHebdo = onSchedule(
  { schedule: "0 18 * * 0", timeZone: "Europe/Paris", region: "europe-west1", secrets: [SMTP_PASS] },
  async () => { await envoyerRecapRevisions(); }
);

exports.recapAnglaisTest = onCall(
  { region: "europe-west1", secrets: [SMTP_PASS], invoker: "public" },
  async (request) => {
    if (request.auth?.uid !== PARENT_UID) throw new HttpsError("permission-denied", "Réservé au parent.");
    await envoyerRecapRevisions("[APERÇU] ");
    return { ok: true, destinataire: RECAP_DESTINATAIRE };
  }
);

// Génère (ou renvoie si déjà faite aujourd'hui) la séance du jour d'un élève dans une matière.
exports.genererExercicesDuJour = onCall(
  { region: "europe-west1", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 180 },
  async (request) => {
    const { eleve, matiere, profil } = contexteAppel(request);
    const today = todayISOAnglais();
    const existingRef = db.collection("exercicesAnglais").doc(`${eleve}_${matiere}_${today}`);
    const existing = await existingRef.get();
    if (existing.exists && !request.data?.regenerer) return existing.data();

    const progSnap = await db.collection("progressionAnglais").where("eleve", "==", eleve).get();
    const toutes = progSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(n => (n.matiere || "anglais") === matiere && n.type !== "figure");
    if (!toutes.length) throw new HttpsError("not-found", "Aucune notion à réviser — ajoute un nouveau cours.");
    let candidates = toutes.filter(n => (n.prochaineDate || "") <= today);
    if (!candidates.length) candidates = [...toutes].sort((a, b) => (a.niveau || 0) - (b.niveau || 0)).slice(0, 30);

    // Priorité : ratées à la dernière réponse, puis jamais vues, puis les plus faibles ; séance équilibrée.
    const rang = n => (n.dernierResultat === false ? 0 : n.dernierVu ? 2 : 1);
    for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
    candidates.sort((a, b) => rang(a) - rang(b) || (a.niveau || 0) - (b.niveau || 0));
    const [nbSavoir, nbRegles] = profil.niveau === "ce2" ? [4, 2] : [5, 3];
    const vocabTous = candidates.filter(n => n.type === "vocabulaire");
    const vocabPrioritaire = vocabTous.filter(n => n.prioritaire);
    const prioritairesMaitrises = vocabPrioritaire.length > 0 && vocabPrioritaire.every(n => (n.niveau || 0) >= 3);
    const poolVocab = vocabPrioritaire.length > 0 && !prioritairesMaitrises ? vocabPrioritaire : vocabTous;
    let notions = [...poolVocab.slice(0, nbSavoir), ...candidates.filter(n => n.type === "grammaire").slice(0, nbRegles)];
    if (notions.length < nbSavoir + nbRegles) {
      notions = [...notions, ...candidates.filter(n => !notions.includes(n)).slice(0, nbSavoir + nbRegles - notions.length)];
    }
    const coursIds = [...new Set(notions.map(n => n.coursId))];
    const coursDocs = await Promise.all(coursIds.map(id => db.collection("coursAnglais").doc(id).get()));
    const coursById = Object.fromEntries(coursDocs.filter(d => d.exists).map(d => [d.id, d.data()]));

    let cadre = "";
    if (matiere === "anglais") {
      cadre = `\n\nVOCABULAIRE DÉJÀ APPRIS EN CLASSE (le seul autorisé en plus des mots anglais très basiques) :\n${(await vocabAnglaisConnu(eleve)).join(", ")}\nRÈGLE STRICTE : aucun mot nouveau ou rare, y compris dans le texte et dans les mauvaises réponses.`;
    }

    const prompt = `Tu es un(e) ${profDe(matiere)} ludique qui prépare une séance quotidienne de ${profil.niveau === "ce2" ? "8 à 10" : "10 à 15"} minutes en ${NOMS_MATIERES[matiere]} pour ${publicEleve(profil)}. Notions à travailler aujourd'hui (certaines jamais testées, d'autres déjà ratées une fois) :
${notions.map(n => ligneNotion(n, coursById[n.coursId])).join("\n")}${cadre}

Génère la séance. Réponds UNIQUEMENT avec un objet JSON (pas de texte avant/après, pas de markdown) au format :
{
  ${blocDecouverte(matiere, profil)},
  "vocabulaire": [ { "notionId": "<id exact donné ci-dessus>", ...un exercice } ],
  "grammaire": [ { "notionId": "<id>", ...un exercice } ]
}
"vocabulaire" = un exercice par notion « À SAVOIR » ; "grammaire" = un exercice par notion « RÈGLE », « MÉTHODE » ou « À COMPRENDRE ». Pas plus d'un exercice par notion. Ton enjoué, jamais scolaire-ennuyeux.

${formatsExos(matiere, profil)}`;
    const parsed = await appelIA(prompt, 8000, effortPour(matiere));
    const reparer = reparateurIds(notions);
    const avecIds = items => (items || []).map(it => ({ ...it, notionId: reparer(it.notionId) }));

    const sessionDoc = {
      version: 4, eleve, matiere, date: today,
      comprehensionEcrite: parsed.comprehensionEcrite || null,
      vocabulaire: avecIds(parsed.vocabulaire),
      grammaire: avecIds(parsed.grammaire),
      genereLe: new Date().toISOString(),
    };
    await existingRef.set(sessionDoc);
    return sessionDoc;
  }
);
