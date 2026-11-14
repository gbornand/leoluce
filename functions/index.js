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
// ENGLISH TIME — outil d'anglais quotidien pour Lucie (feature isolée, ajoutée le 2026-11-13)
// ═══════════════════════════════════════
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const LUCIE_UID = "BmPJ62Hhb0V572vQgzwzybbnU8s2";

function requireLucie(request) {
  if (!request.auth || request.auth.uid !== LUCIE_UID) {
    throw new HttpsError("permission-denied", "Accès réservé.");
  }
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

const EXTRACTION_PROMPT_ANGLAIS = `Tu es un(e) prof d'anglais qui prépare le travail d'une collégienne française.
Analyse la ou les photos de cours d'anglais fournies et extrais-en le contenu pédagogique.

Réponds UNIQUEMENT avec un objet JSON (pas de texte avant/après, pas de markdown) au format exact suivant :
{
  "titre": "titre court du cours (ex: 'Present perfect - unit 4')",
  "recap": "récapitulatif clair et pédagogique du cours, en français, qui réexplique la ou les règles comme à une collégienne (3-8 phrases)",
  "vocabulaire": [
    { "mot": "mot ou expression en anglais", "traduction": "traduction en français", "theme": "thème court en français (ex: La ville, Le caractère, La famille)", "exemple": "courte phrase d'exemple en anglais" }
  ],
  "grammaire": [
    { "titre": "nom court de la notion de grammaire", "explication": "explication pédagogique en français de la règle", "exemples": ["phrase d'exemple en anglais"] }
  ]
}

VOCABULAIRE : sois EXHAUSTIF. Parcours chaque page une par une et relève ABSOLUMENT TOUS les mots et expressions de vocabulaire présents (listes, tableaux, encadrés, lexiques, mots illustrés), sans en omettre, sans résumer, sans regrouper. Plusieurs pages de vocabulaire = plusieurs centaines d'entrées, c'est normal. Regroupe-les par "theme" cohérent (le titre de la rubrique du cours s'il existe). Exemples courts pour rester compact.
Ne mets que ce qui est réellement présent/déductible dans le document. Si le cours ne contient pas de grammaire (ou pas de vocabulaire), le tableau correspondant peut être vide. Niveau collège/lycée français.`;

// Reçoit une ou plusieurs photos d'un cours, les fait analyser par l'IA (vocabulaire +
// grammaire), stocke le cours puis crée une fiche de suivi (répétition espacée) pour
// chaque notion nouvelle, due dès aujourd'hui.
exports.extraireCoursAnglais = onCall(
  { region: "europe-west1", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 900, memory: "512MiB" },
  async (request) => {
    requireLucie(request);
    const images = Array.isArray(request.data?.images) ? request.data.images : [];
    const content = images
      .filter(img => img?.data && img?.mimeType)
      .map(img => img.mimeType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: img.data } }
        : { type: "image", source: { type: "base64", media_type: img.mimeType, data: img.data } });
    if (!content.length) throw new HttpsError("invalid-argument", "Au moins une photo valide est requise.");
    content.push({ type: "text", text: EXTRACTION_PROMPT_ANGLAIS });

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

    const docRef = await db.collection("coursAnglais").add({
      titre: parsed.titre || "Cours d'anglais",
      recap: parsed.recap || "",
      vocabulaire: parsed.vocabulaire || [],
      grammaire: parsed.grammaire || [],
      dateAjout: new Date().toISOString(),
    });

    const today = todayISOAnglais();
    const ecritures = [
      ...(parsed.vocabulaire || []).map(v => [`vocab_${docRef.id}_${slugAnglais(v.mot)}`, {
        type: "vocabulaire", label: v.mot, theme: v.theme || "", coursId: docRef.id,
        niveau: 0, dernierResultat: null, prochaineDate: today, dernierVu: null,
      }]),
      ...(parsed.grammaire || []).map(g => [`gram_${docRef.id}_${slugAnglais(g.titre)}`, {
        type: "grammaire", label: g.titre, coursId: docRef.id,
        niveau: 0, dernierResultat: null, prochaineDate: today, dernierVu: null,
      }]),
    ];
    for (let i = 0; i < ecritures.length; i += 400) {
      const batch = db.batch();
      for (const [id, data] of ecritures.slice(i, i + 400)) {
        batch.set(db.collection("progressionAnglais").doc(id), data, { merge: true });
      }
      await batch.commit();
    }

    return { coursId: docRef.id, titre: parsed.titre, vocabulaire: parsed.vocabulaire || [], grammaire: parsed.grammaire || [] };
  }
);

function todayISOAnglais() { return new Date().toISOString().slice(0, 10); }

const FORMATS_EXOS_ANGLAIS = `Trois types d'exercices possibles (champ "type") :
- "qcm" : { "type": "qcm", "question": "consigne/question EN ANGLAIS", "choix": ["...", "...", "..."], "bonneReponse": 0, "explication": "..." } — 3 ou 4 choix en anglais, "bonneReponse" = index 0-based, varie sa position.
- "trou" : { "type": "trou", "question": "consigne EN ANGLAIS (ex: Complete with the right verb.)", "phrase": "phrase en anglais avec ___ à la place du mot manquant", "reponses": ["réponse attendue", "variante acceptée"], "explication": "..." } — réponse courte (1 à 3 mots), mets toutes les variantes correctes (formes contractées incluses).
- "ordre" : { "type": "ordre", "question": "Put the words in the right order.", "mots": ["words", "of", "the", "sentence", "shuffled"], "reponse": "The full correct sentence", "explication": "..." } — 4 à 9 mots, sans ponctuation finale dans "mots", vraiment mélangés.
LANGUE : tout ce que l'élève lit pour répondre (question, phrase, choix, mots) est EN ANGLAIS simple, niveau collège. Exception : pour tester le sens d'un mot de vocabulaire, une question peut demander la traduction d'un mot français vers l'anglais (ex: How do you say "un château" in English?). Seule "explication" est EN FRANÇAIS : une phrase courte qui explique la bonne réponse.`;

const GENERATION_PROMPT_HEADER_ANGLAIS = `Tu es un(e) prof d'anglais ludique qui prépare une séance quotidienne de 10-15 minutes pour une collégienne française. Voici les notions à travailler aujourd'hui (vocabulaire et grammaire déjà vus en cours, certaines jamais testées, d'autres déjà ratées une fois) :\n\n`;

const GENERATION_PROMPT_FOOTER_ANGLAIS = `

Génère une séance du jour. Réponds UNIQUEMENT avec un objet JSON (pas de texte avant/après, pas de markdown) au format exact :
{
  "comprehensionEcrite": {
    "texte": "court texte en anglais (5-8 phrases), niveau collège/lycée, amusant, qui réutilise si possible du vocabulaire ci-dessus",
    "questions": [ { "type": "qcm", "question": "comprehension question in English", "choix": ["...", "...", "..."], "bonneReponse": 0, "explication": "..." } ]
  },
  "vocabulaire": [ { "notionId": "<reprendre exactement l'id donné ci-dessus>", ...un exercice } ],
  "grammaire": [ { "notionId": "<id>", ...un exercice } ]
}

${FORMATS_EXOS_ANGLAIS}

Un exercice par notion vocabulaire/grammaire listée ci-dessus, pas plus, chacun avec son "notionId". Mélange les types : pour le vocabulaire surtout "qcm" et "trou" ; pour la grammaire surtout "trou" et "ordre". Les questions de compréhension sont des "qcm" (3 questions). Ton enjoué, jamais scolaire-ennuyeux.`;

// Exercices à la demande sur une seule notion (depuis « Mes notions ») — non stockés.
exports.exercicesNotionAnglais = onCall(
  { region: "europe-west1", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120 },
  async (request) => {
    requireLucie(request);
    const notionId = String(request.data?.notionId || "");
    if (!notionId) throw new HttpsError("invalid-argument", "notionId requis.");
    const notionSnap = await db.collection("progressionAnglais").doc(notionId).get();
    if (!notionSnap.exists) throw new HttpsError("not-found", "Notion introuvable.");
    const notion = notionSnap.data();
    const coursSnap = await db.collection("coursAnglais").doc(notion.coursId).get();
    const cours = coursSnap.exists ? coursSnap.data() : {};

    let contexte;
    if (notion.type === "vocabulaire") {
      const v = (cours.vocabulaire || []).find(x => x.mot === notion.label);
      contexte = `VOCABULAIRE "${notion.label}"${v ? ` = ${v.traduction} (ex: ${v.exemple})` : ""}`;
    } else {
      const g = (cours.grammaire || []).find(x => x.titre === notion.label);
      contexte = `GRAMMAIRE "${notion.label}"${g ? ` : ${g.explication} Exemples : ${(g.exemples || []).join(" / ")}` : ""}`;
    }

    const prompt = `Tu es un(e) prof d'anglais ludique. Une collégienne française veut s'entraîner sur cette notion précise :
${contexte}

Génère 5 exercices progressifs (du plus simple au plus exigeant) uniquement sur cette notion, en mélangant les types : au moins 1 "qcm", au moins 2 "trou" et au moins 1 "ordre".
Vocabulaire autorisé : celui du cours de l'élève (${(cours.vocabulaire || []).map(v => v.mot).join(", ")}) et des mots anglais très basiques de niveau débutant. N'introduis aucun mot nouveau ou rare, y compris dans les mauvaises réponses.

${FORMATS_EXOS_ANGLAIS}

Réponds UNIQUEMENT avec un objet JSON (pas de texte avant/après, pas de markdown) : { "exercices": [ ... ] }`;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find(b => b.type === "text");
    if (!textBlock) throw new HttpsError("internal", "Réponse IA vide.");
    const parsed = extractJsonAnglais(textBlock.text);
    return { exercices: parsed.exercices || [] };
  }
);

// Fiche pédagogique d'une chanson (sans reproduire les paroles : droits d'auteur).
exports.ficheChansonAnglais = onCall(
  { region: "europe-west1", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 180, invoker: "public" },
  async (request) => {
    requireLucie(request);
    const id = String(request.data?.id || "").trim();
    const youtubeId = String(request.data?.youtubeId || "").trim();
    const paroles = typeof request.data?.paroles === "string" ? request.data.paroles.replace(/\r/g, "").trim().slice(0, 20000) : null;
    if (youtubeId && !/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) throw new HttpsError("invalid-argument", "Lien YouTube invalide.");
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Mise à jour d'une chanson existante : lien vidéo et/ou paroles collées par l'utilisateur.
    if (id) {
      const ref = db.collection("chansonsAnglais").doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw new HttpsError("not-found", "Chanson introuvable.");
      const maj = {};
      if (request.data?.youtubeId !== undefined) maj.youtubeId = youtubeId;
      if (paroles !== null) {
        maj.paroles = paroles;
        maj.annotations = paroles ? await annoterParolesAnglais(client, snap.data().titre, paroles) : [];
      }
      await ref.update(maj);
      return { id };
    }

    const titre = String(request.data?.titre || "").trim().slice(0, 120);
    const artiste = String(request.data?.artiste || "").trim().slice(0, 120);
    if (!titre) throw new HttpsError("invalid-argument", "Titre requis.");

    const prompt = `Tu es un(e) prof d'anglais ludique. Une collégienne française veut travailler son anglais avec la chanson « ${titre} »${artiste ? ` de ${artiste}` : ""}.

Prépare une fiche d'étude. CONTRAINTE ABSOLUE (droits d'auteur) : ne reproduis PAS les paroles. Pas de couplet, pas de refrain, pas de vers complet. Tu peux seulement citer des expressions isolées de 2 à 5 mots maximum.

Réponds UNIQUEMENT avec un objet JSON (pas de texte avant/après, pas de markdown) :
{
  "connue": true,
  "resume": "de quoi parle la chanson, en français, 3-4 phrases, ton sympa",
  "contexte": "1-2 phrases en français sur l'artiste/l'époque, si utile",
  "expressions": [ { "expression": "expression anglaise courte (2-5 mots) entendue dans la chanson", "sens": "traduction en français", "explication": "explication courte en français (grammaire ou usage)" } ],
  "questions": [ { "type": "qcm", "question": "question EN ANGLAIS sur le sens ou les thèmes de la chanson", "choix": ["...", "...", "..."], "bonneReponse": 0, "explication": "phrase courte en français" } ]
}
6 à 8 expressions utiles pour une collégienne, 4 questions. Si tu ne connais pas cette chanson avec certitude, renvoie { "connue": false } et rien d'autre.`;

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
      titre, artiste, youtubeId,
      resume: fiche.resume || "", contexte: fiche.contexte || "",
      expressions: fiche.expressions || [], questions: fiche.questions || [],
      paroles: paroles || "",
      annotations: paroles ? await annoterParolesAnglais(client, titre, paroles) : [],
      dateAjout: new Date().toISOString(),
    });
    return { id: docRef.id };
  }
);

// Annote des paroles FOURNIES PAR L'UTILISATEUR : expressions courtes repérées ligne par ligne,
// sans traduction intégrale des vers (droits d'auteur).
async function annoterParolesAnglais(client, titre, paroles) {
  const lignes = paroles.split("\n");
  const numerotees = lignes.map((l, i) => `${i}: ${l}`).join("\n");
  const prompt = `Tu es un(e) prof d'anglais pour une collégienne française. Voici les paroles de « ${titre} » collées par l'élève, lignes numérotées :

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

// Génère (ou renvoie si déjà fait aujourd'hui) la séance du jour : sélectionne les notions
// dues (répétition espacée), demande à l'IA de fabriquer les exercices, et les stocke.
exports.genererExercicesDuJour = onCall(
  { region: "europe-west1", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 180 },
  async (request) => {
    requireLucie(request);
    const today = todayISOAnglais();
    const existingRef = db.collection("exercicesAnglais").doc(today);
    const existing = await existingRef.get();
    if (existing.exists && existing.data().version === 3 && !request.data?.regenerer) {
      return existing.data();
    }

    let dueSnap = await db.collection("progressionAnglais")
      .where("prochaineDate", "<=", today)
      .orderBy("prochaineDate")
      .limit(500).get();
    if (dueSnap.empty) {
      dueSnap = await db.collection("progressionAnglais").orderBy("niveau").limit(30).get();
    }
    if (dueSnap.empty) {
      throw new HttpsError("not-found", "Aucune notion à réviser — ajoute un nouveau cours.");
    }

    // Priorité : notions ratées à la dernière réponse, puis jamais vues, puis les plus faibles.
    const rang = n => (n.dernierResultat === false ? 0 : n.dernierVu ? 2 : 1);
    const candidates = dueSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
    candidates.sort((a, b) => rang(a) - rang(b) || (a.niveau || 0) - (b.niveau || 0));
    // Séance équilibrée : 5 mots de vocabulaire + 3 règles de grammaire, complétée par l'autre type si l'un manque.
    const vocabDue = candidates.filter(n => n.type === "vocabulaire");
    const gramDue = candidates.filter(n => n.type === "grammaire");
    let notions = [...vocabDue.slice(0, 5), ...gramDue.slice(0, 3)];
    if (notions.length < 8) {
      const restants = candidates.filter(n => !notions.includes(n));
      notions = [...notions, ...restants.slice(0, 8 - notions.length)];
    }
    const coursIds = [...new Set(notions.map(n => n.coursId))];
    const coursDocs = await Promise.all(coursIds.map(id => db.collection("coursAnglais").doc(id).get()));
    const coursById = Object.fromEntries(coursDocs.filter(d => d.exists).map(d => [d.id, d.data()]));

    const lignes = notions.map(n => {
      const cours = coursById[n.coursId];
      if (n.type === "vocabulaire") {
        const v = (cours?.vocabulaire || []).find(x => x.mot === n.label);
        return `- [id:${n.id}] VOCABULAIRE "${n.label}"${v ? ` = ${v.traduction} (ex: ${v.exemple})` : ""}`;
      }
      const g = (cours?.grammaire || []).find(x => x.titre === n.label);
      return `- [id:${n.id}] GRAMMAIRE "${n.label}"${g ? ` : ${g.explication}` : ""}`;
    }).join("\n");

    const tousCours = await db.collection("coursAnglais").get();
    const vocabConnu = [...new Set(tousCours.docs.flatMap(d => (d.data().vocabulaire || []).map(v => v.mot)))];
    const cadreVocab = `\n\nVOCABULAIRE DÉJÀ APPRIS EN CLASSE (le seul autorisé en plus des mots anglais très basiques de niveau débutant — articles, pronoms, verbes et noms du quotidien) :\n${vocabConnu.join(", ")}\n\nRÈGLE STRICTE : n'introduis AUCUN mot de vocabulaire nouveau ou rare qui ne soit ni dans cette liste ni basique, y compris dans le texte de compréhension et dans les mauvaises réponses des QCM.`;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      messages: [{ role: "user", content: GENERATION_PROMPT_HEADER_ANGLAIS + lignes + cadreVocab + GENERATION_PROMPT_FOOTER_ANGLAIS }],
    });
    const textBlock = response.content.find(b => b.type === "text");
    if (!textBlock) throw new HttpsError("internal", "Réponse IA vide.");
    const parsed = extractJsonAnglais(textBlock.text);

    // L'IA recopie parfois l'id avec « id: » ou des crochets : on le ramène à un id réel, sinon le suivi est perdu.
    const idsValides = new Set(notions.map(n => n.id));
    const reparerId = (brut) => {
      const s = String(brut || "").replace(/^\[?\s*id\s*:\s*/i, "").replace(/\]$/, "").trim();
      if (idsValides.has(s)) return s;
      return notions.find(n => s && (s.includes(n.id) || n.id.includes(s)))?.id || null;
    };
    const avecIds = (items) => (items || []).map(it => ({ ...it, notionId: reparerId(it.notionId) }));

    const sessionDoc = {
      version: 3,
      date: today,
      comprehensionEcrite: parsed.comprehensionEcrite || null,
      vocabulaire: avecIds(parsed.vocabulaire),
      grammaire: avecIds(parsed.grammaire),
      genereLe: new Date().toISOString(),
    };
    await existingRef.set(sessionDoc);
    return sessionDoc;
  }
);
