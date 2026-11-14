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
    { "mot": "mot ou expression en anglais", "traduction": "traduction en français", "exemple": "phrase d'exemple en anglais" }
  ],
  "grammaire": [
    { "titre": "nom court de la notion de grammaire", "explication": "explication pédagogique en français de la règle", "exemples": ["phrase d'exemple en anglais"] }
  ]
}

Ne mets que ce qui est réellement présent/déductible sur la photo. Si le cours ne contient pas de grammaire (ou pas de vocabulaire), le tableau correspondant peut être vide. Niveau collège/lycée français.`;

// Reçoit une ou plusieurs photos d'un cours, les fait analyser par l'IA (vocabulaire +
// grammaire), stocke le cours puis crée une fiche de suivi (répétition espacée) pour
// chaque notion nouvelle, due dès aujourd'hui.
exports.extraireCoursAnglais = onCall(
  { region: "europe-west1", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 300, memory: "512MiB" },
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
    const response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      messages: [{ role: "user", content }],
    });
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
    const batch = db.batch();
    for (const v of parsed.vocabulaire || []) {
      const id = `vocab_${docRef.id}_${slugAnglais(v.mot)}`;
      batch.set(db.collection("progressionAnglais").doc(id), {
        type: "vocabulaire", label: v.mot, coursId: docRef.id,
        niveau: 0, dernierResultat: null, prochaineDate: today, dernierVu: null,
      }, { merge: true });
    }
    for (const g of parsed.grammaire || []) {
      const id = `gram_${docRef.id}_${slugAnglais(g.titre)}`;
      batch.set(db.collection("progressionAnglais").doc(id), {
        type: "grammaire", label: g.titre, coursId: docRef.id,
        niveau: 0, dernierResultat: null, prochaineDate: today, dernierVu: null,
      }, { merge: true });
    }
    await batch.commit();

    return { coursId: docRef.id, titre: parsed.titre, vocabulaire: parsed.vocabulaire || [], grammaire: parsed.grammaire || [] };
  }
);

function todayISOAnglais() { return new Date().toISOString().slice(0, 10); }

const GENERATION_PROMPT_HEADER_ANGLAIS = `Tu es un(e) prof d'anglais ludique qui prépare une séance quotidienne de 10-15 minutes pour une collégienne française. Voici les notions à travailler aujourd'hui (vocabulaire et grammaire déjà vus en cours, certaines jamais testées, d'autres déjà ratées une fois) :\n\n`;

const GENERATION_PROMPT_FOOTER_ANGLAIS = `

Génère une séance du jour. Réponds UNIQUEMENT avec un objet JSON (pas de texte avant/après, pas de markdown) au format exact :
{
  "comprehensionEcrite": {
    "texte": "court texte en anglais (5-8 phrases), niveau collège/lycée, amusant, qui réutilise si possible du vocabulaire ci-dessus",
    "questions": [ { "question": "question de compréhension en français", "choix": ["...", "...", "..."], "bonneReponse": 0 } ]
  },
  "vocabulaire": [ { "notionId": "<reprendre exactement l'id donné ci-dessus>", "question": "question ludique en français pour tester ce mot (traduction, intrus, compléter la phrase...)", "choix": ["...", "...", "..."], "bonneReponse": 0 } ],
  "grammaire": [ { "notionId": "<id>", "question": "question ludique en français pour tester cette règle", "choix": ["...", "...", "..."], "bonneReponse": 0 } ]
}
Chaque "choix" contient 3 ou 4 propositions, "bonneReponse" est l'index (0-based) de la bonne. Un exercice par notion vocabulaire/grammaire listée ci-dessus, pas plus. Ton enjoué, jamais scolaire-ennuyeux.`;

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

Génère 4 exercices variés et progressifs (du plus simple au plus exigeant) uniquement sur cette notion. Réponds UNIQUEMENT avec un objet JSON (pas de texte avant/après, pas de markdown) :
{ "exercices": [ { "question": "consigne en français, phrase à compléter ou à traduire si besoin", "choix": ["...", "...", "..."], "bonneReponse": 0, "explication": "une phrase courte en français qui explique pourquoi c'est la bonne réponse" } ] }
3 ou 4 choix par question, "bonneReponse" = index 0-based. Varie la position de la bonne réponse.`;

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

// Génère (ou renvoie si déjà fait aujourd'hui) la séance du jour : sélectionne les notions
// dues (répétition espacée), demande à l'IA de fabriquer les exercices, et les stocke.
exports.genererExercicesDuJour = onCall(
  { region: "europe-west1", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 180 },
  async (request) => {
    requireLucie(request);
    const today = todayISOAnglais();
    const existingRef = db.collection("exercicesAnglais").doc(today);
    const existing = await existingRef.get();
    if (existing.exists && !request.data?.regenerer) {
      return existing.data();
    }

    const dueSnap = await db.collection("progressionAnglais")
      .where("prochaineDate", "<=", today)
      .orderBy("prochaineDate")
      .limit(30).get();
    if (dueSnap.empty) {
      throw new HttpsError("not-found", "Aucune notion à réviser — ajoute un nouveau cours.");
    }

    const notions = dueSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.niveau - b.niveau)
      .slice(0, 8);
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

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: GENERATION_PROMPT_HEADER_ANGLAIS + lignes + GENERATION_PROMPT_FOOTER_ANGLAIS }],
    });
    const textBlock = response.content.find(b => b.type === "text");
    if (!textBlock) throw new HttpsError("internal", "Réponse IA vide.");
    const parsed = extractJsonAnglais(textBlock.text);

    const sessionDoc = {
      date: today,
      comprehensionEcrite: parsed.comprehensionEcrite || null,
      vocabulaire: parsed.vocabulaire || [],
      grammaire: parsed.grammaire || [],
      genereLe: new Date().toISOString(),
    };
    await existingRef.set(sessionDoc);
    return sessionDoc;
  }
);
