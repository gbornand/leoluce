const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const fs = require("fs");
const path = require("path");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const nodemailer = require("nodemailer");

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
