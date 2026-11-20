// ============================================================
// English Time — outil d'anglais quotidien pour Lucie (Firebase modular SDK v10, pas de build step)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, updateDoc, getDocs, query, where, addDoc, deleteDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// Branche un événement sans planter si l'élément manque (page en cache plus ancienne que le script).
function sur(id, evenement, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(evenement, fn);
}

const firebaseConfig = {
  apiKey: "AIzaSyBpKc6h0mjkTff5KJBD0_A4IBePsR4cU3w",
  authDomain: "leoluce-edu.firebaseapp.com",
  projectId: "leoluce-edu",
  storageBucket: "leoluce-edu.firebasestorage.app",
  messagingSenderId: "334537788019",
  appId: "1:334537788019:web:f53426f0c480bfd771f806"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "europe-west1");

const NIVEAUX_JOURS = [0, 1, 3, 7, 14, 30];

function todayISO() { return new Date().toISOString().slice(0, 10); }

// ------------------------------------------------------------
// AUTH
// ------------------------------------------------------------
sur("btn-toggle-password", "click", () => {
  const input = document.getElementById("login-password");
  const btn = document.getElementById("btn-toggle-password");
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  btn.textContent = showing ? "👁" : "🙈";
  btn.title = showing ? "Afficher le mot de passe" : "Masquer le mot de passe";
});

sur("login-form", "submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.hidden = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    const messages = {
      "auth/invalid-credential": "Email ou mot de passe incorrect.",
      "auth/wrong-password": "Email ou mot de passe incorrect.",
      "auth/user-not-found": "Aucun compte avec cet email.",
      "auth/invalid-email": "Cette adresse email n'est pas valide (vérifie les espaces ou majuscules).",
      "auth/too-many-requests": "Trop d'essais : attends quelques minutes, ou utilise « Mot de passe oublié ? ».",
      "auth/network-request-failed": "Pas de connexion internet, réessaie.",
      "auth/user-disabled": "Ce compte est désactivé.",
    };
    errorEl.textContent = messages[err?.code] || `Connexion impossible (${err?.code || "erreur inconnue"}).`;
    errorEl.hidden = false;
  }
});

sur("btn-forgot-password", "click", async () => {
  const email = document.getElementById("login-email").value.trim();
  const errorEl = document.getElementById("login-error");
  const okEl = document.getElementById("login-reset-ok");
  errorEl.hidden = true;
  okEl.hidden = true;
  if (!email) {
    errorEl.textContent = "Entre d'abord ton email ci-dessus.";
    errorEl.hidden = false;
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    okEl.textContent = "Email envoyé ! Regarde ta boîte mail pour choisir un nouveau mot de passe.";
    okEl.hidden = false;
  } catch (err) {
    if (err?.code === "auth/too-many-requests") {
      errorEl.textContent = "Trop de demandes pour ce compte : Google bloque les envois pendant un moment. Réessaie dans une heure.";
      errorEl.hidden = false;
    } else if (err?.code === "auth/invalid-email") {
      errorEl.textContent = "Cette adresse email n'est pas valide.";
      errorEl.hidden = false;
    } else {
      okEl.textContent = "Si ce compte existe, un email vient d'être envoyé.";
      okEl.hidden = false;
    }
  }
});

sur("btn-logout", "click", () => signOut(auth));

// Changer son mot de passe une fois connecté (sans passer par un email).
sur("btn-mdp", "click", () => {
  const corps = ouvrirLibre(`<div class="game-head hdr-controle"><div class="modal-kicker">🔑 Mon compte</div><h3>Changer mon mot de passe</h3></div>
    <div class="game-body">
      <label class="fig-label">Nouveau mot de passe (6 caractères minimum)
        <div class="password-field"><input type="password" id="mdp-nouveau" autocomplete="new-password"><button type="button" class="btn-toggle-password" data-cible="mdp-nouveau">👁</button></div></label>
      <label class="fig-label">Confirme-le
        <div class="password-field"><input type="password" id="mdp-confirme" autocomplete="new-password"><button type="button" class="btn-toggle-password" data-cible="mdp-confirme">👁</button></div></label>
      <button class="btn-primary btn-block" id="mdp-valider">Enregistrer</button>
      <p class="muted" id="mdp-statut"></p>
    </div>`);
  corps.querySelectorAll("[data-cible]").forEach(b => b.addEventListener("click", () => {
    const input = corps.querySelector(`#${b.dataset.cible}`);
    input.type = input.type === "password" ? "text" : "password";
  }));
  corps.querySelector("#mdp-valider").addEventListener("click", async () => {
    const nouveau = corps.querySelector("#mdp-nouveau").value;
    const statut = corps.querySelector("#mdp-statut");
    if (nouveau.length < 6) { statut.textContent = "6 caractères minimum."; return; }
    if (nouveau !== corps.querySelector("#mdp-confirme").value) { statut.textContent = "Les deux mots de passe ne sont pas identiques."; return; }
    try {
      await updatePassword(auth.currentUser, nouveau);
      statut.textContent = "✅ Mot de passe changé ! Utilise-le maintenant sur tous tes appareils.";
    } catch (err) {
      console.error(err);
      statut.textContent = err?.code === "auth/requires-recent-login"
        ? "Par sécurité, déconnecte-toi puis reconnecte-toi, et recommence tout de suite."
        : "❌ Impossible de changer le mot de passe pour l'instant.";
    }
  });
});

// ------------------------------------------------------------
// ÉLÈVES & MATIÈRES
// ------------------------------------------------------------
const MATIERES_UI = {
  anglais: { nom: "Anglais", emoji: "🔤", savoir: "🔤 Vocabulaire", regle: "📐 Grammaire", savoirCourt: "mots", regleCourt: "règles" },
  espagnol: { nom: "Espagnol", emoji: "💃", savoir: "💃 Vocabulario", regle: "📐 Gramática", savoirCourt: "mots", regleCourt: "règles" },
  francais: { nom: "Français", emoji: "✏️", savoir: "✏️ Mots à savoir", regle: "📐 Règles", savoirCourt: "mots", regleCourt: "règles" },
  tables: { nom: "Tables", emoji: "✖️", savoir: "✖️ Calculs", regle: "📐 Astuces", savoirCourt: "calculs", regleCourt: "astuces" },
  dictee: { nom: "Dictée", emoji: "🎧", savoir: "🎧 Mots de la dictée", regle: "📐 Règles", savoirCourt: "mots", regleCourt: "règles" },
  maths: { nom: "Maths", emoji: "🧮", savoir: "📏 À connaître par cœur", regle: "🧮 Méthodes", savoirCourt: "à savoir", regleCourt: "méthodes" },
  physique: { nom: "Physique", emoji: "⚛️", savoir: "⚛️ À connaître", regle: "🔬 Méthodes", savoirCourt: "à savoir", regleCourt: "méthodes" },
  svt: { nom: "SVT", emoji: "🌿", savoir: "🌿 Notions & définitions", regle: "🔬 À comprendre", savoirCourt: "notions", regleCourt: "à comprendre" },
  histoire: { nom: "Histoire-géo", emoji: "🌍", savoir: "📅 Repères & définitions", regle: "🏛️ À comprendre", savoirCourt: "repères", regleCourt: "à comprendre" },
};

let profil = null;
// Compte parent utilisé par un enfant sur l'ordi de la maison : ses réponses sont enregistrées comme les siennes.
let modeEleve = false;
let eleveCourant = null;
let matiereCourante = null;

function eleveInfo() { return profil?.eleves.find(e => e.uid === eleveCourant); }
function ui() { return MATIERES_UI[matiereCourante] || MATIERES_UI.anglais; }
function lireLocal(cle) { try { return localStorage.getItem(cle); } catch { return null; } }
function ecrireLocal(cle, val) { try { localStorage.setItem(cle, val); } catch {} }

function choisirContexte(eleve, matiere) {
  eleveCourant = eleve;
  const info = eleveInfo();
  matiereCourante = info.matieres.includes(matiere) ? matiere : (lireLocal(`matiere-${eleve}`) && info.matieres.includes(lireLocal(`matiere-${eleve}`)) ? lireLocal(`matiere-${eleve}`) : info.matieres[0]);
  ecrireLocal("eleve-courant", eleve);
  ecrireLocal(`matiere-${eleve}`, matiereCourante);
  notionsById = {};
  coursById = {};
  renderContexte();
  appliquerMatiere();
  loadToday();
  loadNotions();
  if (!document.getElementById("tab-chansons").hidden) loadChansons();
  if (!document.getElementById("tab-controles").hidden) loadControles();
}

function renderContexte() {
  const bar = document.getElementById("contexte-bar");
  const enfants = profil.role === "parent"
    ? `<div class="ctx-enfants">${profil.eleves.map(e => `<button class="ctx-enfant${e.uid === eleveCourant ? " active" : ""}" data-eleve="${esc(e.uid)}">${esc(e.prenom)}</button>`).join("")}</div>`
    : "";
  const prenom = esc(eleveInfo().prenom);
  const apercu = profil.role !== "parent" ? ""
    : modeEleve
      ? `<div class="ctx-apercu ctx-eleve">✏️ C'est <b>${prenom}</b> qui travaille : ses réponses comptent. <button class="ctx-bascule" data-bascule="parent">↩️ Mode parent</button></div>`
      : `<div class="ctx-apercu">👁️ Aperçu de l'écran de ${prenom} (rien n'est enregistré). <button class="ctx-bascule ctx-bascule-go" data-bascule="eleve">▶️ Faire travailler ${prenom}</button></div>`;
  bar.innerHTML = `${enfants}${apercu}<div class="ctx-matieres">${eleveInfo().matieres.filter(m => MATIERES_UI[m]).map(m => `<button class="ctx-matiere${m === matiereCourante ? " active" : ""}" data-matiere="${m}">${MATIERES_UI[m].emoji} ${MATIERES_UI[m].nom}</button>`).join("")}</div>`;
  bar.querySelectorAll("[data-eleve]").forEach(b => b.addEventListener("click", () => choisirContexte(b.dataset.eleve, null)));
  bar.querySelectorAll("[data-matiere]").forEach(b => b.addEventListener("click", () => choisirContexte(eleveCourant, b.dataset.matiere)));
  bar.querySelectorAll("[data-bascule]").forEach(b => b.addEventListener("click", () => basculerModeEleve(b.dataset.bascule === "eleve")));
}

function basculerModeEleve(actif) {
  modeEleve = actif;
  ecrireLocal("mode-eleve", actif ? "1" : "");
  const eleve = eleveCourant, matiere = matiereCourante;
  reinitialiserEcran();
  choisirContexte(eleve, matiere);
  const cible = document.querySelector(`.tab-btn[data-tab="${estParent() ? "dashboard" : "today"}"]`);
  if (!cible.hidden) cible.click();
  window.scrollTo(0, 0);
}

function estParent() { return profil?.role === "parent" && !modeEleve; }

// À chaque changement de compte : rien de la session précédente ne doit rester affiché.
function reinitialiserEcran() {
  document.getElementById("modal-libre").hidden = true;
  document.getElementById("modal-notion").hidden = true;
  clearInterval(jeuTimer);
  ["dashboard-contenu", "dictee-contenu", "tables-contenu", "controles-contenu", "notions-list", "songs-list", "vocab-questions", "gram-questions", "ce-questions", "figure-du-jour", "contexte-bar"]
    .forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ""; });
  document.getElementById("today-score").hidden = true;
  document.getElementById("today-content").hidden = true;
  document.getElementById("streak").hidden = true;
  document.querySelectorAll(".tab-panel").forEach(p => { p.hidden = p.id !== "tab-today"; });
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === "today"));
  document.querySelector('.tab-btn[data-tab="dashboard"]').hidden = true;
  document.querySelector('.tab-btn[data-tab="dictee"]').hidden = true;
  document.querySelector('.tab-btn[data-tab="tables"]').hidden = true;
  document.querySelector('.tab-btn[data-tab="controles"]').hidden = true;
  document.getElementById("dst-bandeau").hidden = true;
  dicteeChoisie = null;
  notionsById = {};
  coursById = {};
  figuresById = {};
}

function appliquerMatiere() {
  const parent = estParent();
  document.querySelector('.tab-btn[data-tab="dashboard"]').hidden = !parent;
  const dictee = matiereCourante === "dictee";
  const tables = matiereCourante === "tables";
  const special = dictee || tables;
  document.querySelector('.tab-btn[data-tab="today"]').hidden = special;
  document.querySelector('.tab-btn[data-tab="entrainer"]').hidden = special;
  document.getElementById("btn-autre-seance").style.display = parent ? "none" : "";
  document.querySelector('.tab-btn[data-tab="notions"]').hidden = special;
  document.querySelector('.tab-btn[data-tab="add"]').hidden = tables;
  document.querySelector('.tab-btn[data-tab="dictee"]').hidden = !dictee;
  document.querySelector('.tab-btn[data-tab="tables"]').hidden = !tables;
  document.querySelector('.tab-btn[data-tab="controles"]').hidden = eleveInfo()?.niveau === "ce2";
  document.querySelector('.tab-btn[data-tab="add"]').textContent = dictee ? "+ Une dictée" : "+ Un cours";
  const titreAjout = document.querySelector("#tab-add h2");
  if (titreAjout) titreAjout.textContent = dictee ? "Ajoute ta nouvelle liste de mots" : "Ajoute un cours";
  document.querySelector('.tab-btn[data-tab="notions"]').textContent = parent ? "Notions" : "Mes notions";
  const actif = document.querySelector(".tab-btn.active");
  if (!actif || actif.hidden || (special && !["add", "dashboard", "controles"].includes(actif.dataset.tab))) {
    document.querySelector(`.tab-btn[data-tab="${dictee ? "dictee" : tables ? "tables" : parent ? "dashboard" : "today"}"]`).click();
  }
  const anglais = matiereCourante === "anglais";
  const tabChansons = document.querySelector('.tab-btn[data-tab="chansons"]');
  tabChansons.hidden = !anglais;
  if (!anglais && !document.getElementById("tab-chansons").hidden) document.querySelector(`.tab-btn[data-tab="${parent ? "dashboard" : "today"}"]`).click();
  document.getElementById("btn-pron").hidden = !anglais;
  document.getElementById("btn-dictee").hidden = !["anglais", "espagnol", "francais"].includes(matiereCourante);
  document.getElementById("recap-parent").hidden = !estParent();
  document.getElementById("titre-bloc-savoir").textContent = ui().savoir;
  document.getElementById("titre-bloc-regle").textContent = ui().regle;
  document.getElementById("add-matiere-badge").textContent = dictee
    ? "🎧 Nouvelle dictée : elle devient la dictée de la semaine, l'ancienne passe dans les archives"
    : `📥 Ce cours sera rangé dans : ${ui().emoji} ${MATIERES_UI[matiereCourante].nom} — vérifie l'onglet en haut si ce n'est pas ça`;
}

onAuthStateChanged(auth, async (user) => {
  document.getElementById("screen-login").hidden = !!user;
  document.getElementById("screen-app").hidden = !user;
  reinitialiserEcran();
  if (!user) { profil = null; eleveCourant = null; matiereCourante = null; modeEleve = false; return; }
  try {
    const initialiserRevisions = httpsCallable(functions, "initialiserRevisions", { timeout: 300000 });
    profil = await initialiserRevisions({}).then(r => r.data);
  } catch (err) {
    console.error(err);
    document.getElementById("today-loading").textContent = "Ce compte n'a pas accès aux révisions.";
    return;
  }
  const memo = lireLocal("eleve-courant");
  modeEleve = profil.role === "parent" && lireLocal("mode-eleve") === "1";
  choisirContexte(profil.eleves.some(e => e.uid === memo) ? memo : profil.eleves[0].uid, null);
  const accueil = document.querySelector(`.tab-btn[data-tab="${estParent() ? "dashboard" : "today"}"]`);
  if (!accueil.hidden) accueil.click();
});

// ------------------------------------------------------------
// TABS
// ------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab-panel").forEach(p => p.hidden = true);
    document.getElementById(`tab-${btn.dataset.tab}`).hidden = false;
    if (btn.dataset.tab === "notions") loadNotions();
    if (btn.dataset.tab === "dictee") loadDictee();
    if (btn.dataset.tab === "tables") loadTables();
    if (btn.dataset.tab === "controles") loadControles();
    if (btn.dataset.tab === "dashboard") loadDashboard();
    if (btn.dataset.tab === "chansons") loadChansons();
    if (btn.dataset.tab === "entrainer" && !Object.keys(notionsById).length) loadNotions();
    if (btn.dataset.tab === "today" && document.getElementById("today-content").hidden) loadToday();
  });
});

// ------------------------------------------------------------
// AUJOURD'HUI — exercices du jour
// ------------------------------------------------------------
let notionsById = {};
let coursById = {};
let score = { bonnes: 0, total: 0 };

function idSeanceDuJour() { return `${eleveCourant}_${matiereCourante}_${todayISO()}`; }

async function genererSeance(regenerer) {
  const genererExercicesDuJour = httpsCallable(functions, "genererExercicesDuJour", { timeout: 180000 });
  return genererExercicesDuJour({ eleve: eleveCourant, matiere: matiereCourante, regenerer }).then(r => r.data);
}

// Une seule génération à la fois par séance (élève + matière + jour), même si l'écran se recharge plusieurs fois.
const generationsEnCours = {};
function genererSeanceUnique(contexte) {
  if (!generationsEnCours[contexte]) {
    generationsEnCours[contexte] = genererSeance(false).finally(() => { delete generationsEnCours[contexte]; });
  }
  return generationsEnCours[contexte];
}

async function loadToday() {
  if (matiereCourante === "dictee" || matiereCourante === "tables") return;
  afficherBandeauControle();
  document.getElementById("today-loading").hidden = false;
  document.getElementById("today-loading").textContent = "Chargement de la séance du jour…";
  document.getElementById("today-empty").hidden = true;
  document.getElementById("today-content").hidden = true;
  const contexte = idSeanceDuJour();

  try {
    let data;
    try {
      const snap = await getDoc(doc(db, "exercicesAnglais", contexte));
      if (snap.exists()) data = snap.data();
    } catch {}
    if (!data) data = await genererSeanceUnique(contexte);
    if (contexte !== idSeanceDuJour()) return;
    renderToday(data);
  } catch (err) {
    if (contexte !== idSeanceDuJour()) return;
    document.getElementById("today-loading").hidden = true;
    document.getElementById("today-empty").hidden = false;
    document.getElementById("today-empty").textContent =
      err?.message?.includes("Aucune notion")
        ? `Pas encore de cours de ${ui().nom.toLowerCase()} — va dans + Un cours pour ajouter le premier 📸`
        : "Oups, impossible de charger la séance du jour. Réessaie un peu plus tard.";
  }
}

function renderToday(data) {
  document.getElementById("today-loading").hidden = true;
  document.getElementById("today-content").hidden = false;
  document.getElementById("today-score").hidden = true;
  score = { bonnes: 0, total: 0, repondues: 0, erreurs: [] };
  document.getElementById("today-date").textContent = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  document.getElementById("block-comprehension").hidden = false;
  document.getElementById("block-vocabulaire").hidden = !(data.vocabulaire || []).length;
  document.getElementById("block-grammaire").hidden = !(data.grammaire || []).length;
  if (data.terminee && data.resultat) {
    ["block-comprehension", "block-vocabulaire", "block-grammaire"].forEach(id => { document.getElementById(id).hidden = true; });
    afficherBilan(data.resultat);
    return;
  }

  const ceBlock = document.getElementById("block-comprehension");
  const ce = data.comprehensionEcrite;
  if (ce?.texte) {
    ceBlock.hidden = false;
    const mode = ce.mode || "ecoute";
    const ecoute = mode === "ecoute";
    texteEcoute = ce.texte;
    langueEcoute = langueMatiere(matiereCourante);
    const icone = { ecoute: "🎧", lecture: "📖", probleme: "🧩" }[mode] || "📖";
    document.getElementById("ce-titre").textContent = `${icone} ${ce.titre || (ecoute ? "Écoute & compréhension" : "Lecture")}`;
    document.getElementById("ce-consigne").textContent = ecoute
      ? "Écoute d'abord, réponds aux questions. Lis le texte seulement si tu bloques."
      : mode === "probleme" ? "Lis bien l'énoncé, puis réponds." : "Lis le texte, puis réponds aux questions.";
    document.getElementById("ce-texte").innerHTML = matiereCourante === "anglais" ? motsCliquables(texteEcoute) : esc(texteEcoute);
    document.getElementById("ce-texte").hidden = ecoute;
    document.getElementById("btn-show-text").hidden = !ecoute;
    document.querySelector(".audio-player").hidden = !(ecoute || matiereCourante === "francais");
    renderTodayList("ce-questions", ce.questions || [], false);
  } else {
    ceBlock.hidden = true;
  }
  renderTodayList("vocab-questions", data.vocabulaire || [], true);
  renderTodayList("gram-questions", data.grammaire || [], true);
  afficherFigureDuJour();
}

// ÉCOUTE : synthèse vocale du navigateur, voix anglaise (gratuit, hors ligne selon l'appareil).
let texteEcoute = "";
let langueEcoute = "en";
let vitesseEcoute = 0.95;

const CODES_LANGUE = { fr: "fr-FR", en: "en-GB", es: "es-ES" };
function langueMatiere(m) { return m === "anglais" ? "en" : m === "espagnol" ? "es" : "fr"; }

function voixPour(langue) {
  const voix = speechSynthesis.getVoices();
  const code = CODES_LANGUE[langue] || "fr-FR";
  return voix.find(v => v.lang === code && /google|natural|online/i.test(v.name))
    || voix.find(v => v.lang === code)
    || voix.find(v => v.lang.toLowerCase().startsWith(langue));
}

function voixAnglaise() { return voixPour("en"); }

function majBoutonEcoute(enCours) {
  document.getElementById("btn-play").textContent = enCours ? "❚❚" : "▶";
  document.getElementById("audio-title").textContent = enCours ? "Lecture en cours…" : "Écouter le texte";
}

sur("btn-play", "click", () => {
  if (!("speechSynthesis" in window)) {
    document.getElementById("audio-title").textContent = "Lecture audio non disponible sur cet appareil";
    return;
  }
  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    majBoutonEcoute(false);
    return;
  }
  const u = new SpeechSynthesisUtterance(texteEcoute);
  const v = voixPour(langueEcoute);
  if (v) u.voice = v;
  u.lang = v?.lang || CODES_LANGUE[langueEcoute] || "fr-FR";
  u.rate = vitesseEcoute;
  u.onend = () => majBoutonEcoute(false);
  u.onerror = () => majBoutonEcoute(false);
  speechSynthesis.speak(u);
  majBoutonEcoute(true);
});

document.querySelectorAll(".speed-btn").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".speed-btn").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  vitesseEcoute = Number(b.dataset.rate);
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); majBoutonEcoute(false); }
}));

sur("btn-show-text", "click", (e) => {
  document.getElementById("ce-texte").hidden = false;
  e.currentTarget.hidden = true;
});

if ("speechSynthesis" in window) speechSynthesis.getVoices();

function renderTodayList(containerId, items, suiviNotion) {
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  items.forEach((item) => {
    score.total += 1;
    el.appendChild(renderExercise(item, {
      onRevoir: suiviNotion && item.notionId ? () => openNotionModal(item.notionId) : null,
      onAnswered: (correct, donnee) => {
        score.repondues += 1;
        if (correct) score.bonnes += 1;
        const trace = { question: item.phrase || item.question || "", reponse: donnee };
        if (suiviNotion && item.notionId) enregistrerReponse(item.notionId, correct, { source: "seance", ...trace });
        else journaliser({ correct, source: suiviNotion ? "seance" : "comprehension", ...trace });
        if (!correct) score.erreurs.push({ question: item.question || "", phrase: item.phrase || "", notionId: suiviNotion ? item.notionId || null : null });
        if (score.repondues === score.total) finSeance();
      },
    }));
  });
}

async function finSeance() {
  const resultat = { score: score.bonnes, total: score.total, erreurs: score.erreurs, finieLe: new Date().toISOString() };
  afficherBilan(resultat);
  if (estParent()) return;
  try {
    await addDoc(collection(db, "seancesAnglais"), { type: "jour", eleve: eleveCourant, matiere: matiereCourante, date: todayISO(), ...resultat });
    await updateDoc(doc(db, "exercicesAnglais", idSeanceDuJour()), { terminee: true, resultat });
  } catch (err) {
    console.error("Enregistrement séance", err);
  }
}

function afficherBilan(resultat) {
  const s = document.getElementById("today-score");
  const pct = resultat.total ? resultat.score / resultat.total : 0;
  const message = pct === 1 ? "🏆 Sans faute, bravo !" : pct >= 0.7 ? "🎉 Très bien joué !" : pct >= 0.5 ? "👍 Pas mal, on continue !" : "💪 Courage, ça va venir !";
  const aRevoir = resultat.erreurs.filter(e => e.notionId);
  s.hidden = false;
  s.className = "bilan";
  s.innerHTML = `
    <div class="bilan-head">
      <div class="bilan-score">${resultat.score}<span>/${resultat.total}</span></div>
      <div><div class="bilan-msg">${message}</div><div class="bilan-sub">Séance enregistrée.${resultat.erreurs.length ? " Les notions ratées reviendront en priorité." : ""}</div></div>
    </div>
    ${aRevoir.length ? `<div class="exemples-title">À retravailler</div>
      <div class="bilan-erreurs">${aRevoir.map(e => {
        const n = notionsById[e.notionId];
        return `<button class="bilan-erreur" data-revoir="${esc(e.notionId)}"><span>${esc(n?.label || e.phrase || e.question)}</span><span class="bilan-go">💡 Revoir et s'entraîner</span></button>`;
      }).join("")}</div>` : ""}
    <div class="bilan-actions"${estParent() ? " style=\"display:none\"" : ""}>
      <button class="btn-primary" id="btn-nouvelle-seance">🔁 Nouvelle séance${resultat.erreurs.length ? " (on reprend tes erreurs)" : ""}</button>
    </div>`;
  s.querySelectorAll("[data-revoir]").forEach(b => b.addEventListener("click", () => openNotionModal(b.dataset.revoir)));
  s.querySelector("#btn-nouvelle-seance").addEventListener("click", nouvelleSeance);
  s.scrollIntoView({ behavior: "smooth", block: "center" });
}

sur("btn-autre-seance", "click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = "Préparation… ✍️";
  try {
    renderToday(await genererSeance(true));
  } catch (err) {
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔁 Autre séance";
  }
});

async function nouvelleSeance() {
  const btn = document.getElementById("btn-nouvelle-seance");
  btn.disabled = true;
  btn.textContent = "La prof IA prépare une nouvelle séance… ✍️";
  try {
    renderToday(await genererSeance(true));
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    btn.textContent = "❌ Échec, réessayer";
  }
}

function normaliser(s) {
  return String(s || "").toLowerCase().replace(/[’`]/g, "'")
    .replace(/(\d)[.,](\d)/g, "$1§$2")
    .replace(/(\d)\s+(?=\d)/g, "$1")
    .replace(/\bste\b/g, "sainte").replace(/\bst\b/g, "saint")
    .replace(/[.,!?;:"]/g, "")
    .replace(/§/g, ".")
    .replace(/\s+/g, " ").trim();
}

// Rend un exercice (qcm | trou | ordre) et appelle onAnswered(correct) une seule fois.
function renderExercise(ex, { onAnswered, onRevoir } = {}) {
  const type = ex.type || "qcm";
  const card = document.createElement("div");
  card.className = "question-card";

  const label = document.createElement("div");
  label.className = "question-label";
  const badge = { qcm: "Choix", trou: "À compléter", ordre: "Dans l'ordre" }[type] || "Choix";
  label.innerHTML = `<span><span class="exo-type exo-type-${type}">${badge}</span> </span>`;
  label.firstChild.appendChild(document.createTextNode(ex.question || ""));
  if (onRevoir) {
    const btnRevoir = document.createElement("button");
    btnRevoir.className = "btn-revoir";
    btnRevoir.textContent = "💡 Revoir";
    btnRevoir.addEventListener("click", onRevoir);
    label.appendChild(btnRevoir);
  }
  card.appendChild(label);

  let done = false;
  const finish = (correct, bonneReponseTexte, donnee) => {
    if (done) return;
    done = true;
    card.classList.add(correct ? "is-correct" : "is-incorrect");
    const expl = document.createElement("div");
    expl.className = "exo-explication";
    const solution = !correct && bonneReponseTexte ? `Réponse : « ${bonneReponseTexte} ». ` : "";
    expl.textContent = `${correct ? "✅ Bravo ! " : "💡 "}${solution}${ex.explication || ""}`;
    card.appendChild(expl);
    onAnswered?.(correct, donnee);
  };

  if (type === "trou") {
    if (ex.phrase) {
      const p = document.createElement("div");
      p.className = "exo-phrase";
      p.textContent = ex.phrase;
      card.appendChild(p);
    }
    const row = document.createElement("div");
    row.className = "exo-input-row";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "exo-input";
    input.placeholder = "Ta réponse…";
    input.autocapitalize = "off";
    input.autocomplete = "off";
    input.spellcheck = false;
    const ok = document.createElement("button");
    ok.className = "btn-primary btn-small";
    ok.textContent = "Valider";
    const valider = () => {
      if (!input.value.trim()) return;
      const attendues = (ex.reponses || []).map(normaliser);
      const correct = attendues.includes(normaliser(input.value));
      input.disabled = true; ok.disabled = true;
      input.classList.add(correct ? "correct" : "incorrect");
      finish(correct, (ex.reponses || [])[0], input.value.trim());
    };
    ok.addEventListener("click", valider);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") valider(); });
    row.append(input, ok);
    card.appendChild(row);
  } else if (type === "ordre") {
    const parEtapes = String(ex.reponse || "").includes("|");
    const cible = document.createElement("div");
    cible.className = "ordre-cible";
    const reserve = document.createElement("div");
    reserve.className = "ordre-reserve";
    const choisis = [];
    const majCible = () => {
      cible.textContent = choisis.length ? choisis.map(c => c.mot).join(parEtapes ? " → " : " ") : "Clique sur les éléments dans le bon ordre…";
      cible.classList.toggle("vide", !choisis.length);
    };
    (ex.mots || []).forEach((mot) => {
      const chip = document.createElement("button");
      chip.className = "mot-chip";
      chip.textContent = mot;
      chip.addEventListener("click", () => {
        if (done || chip.disabled) return;
        chip.disabled = true;
        choisis.push({ mot, chip });
        majCible();
      });
      reserve.appendChild(chip);
    });
    const actions = document.createElement("div");
    actions.className = "exo-input-row";
    const effacer = document.createElement("button");
    effacer.className = "btn-ghost-small";
    effacer.textContent = "↺ Recommencer";
    effacer.addEventListener("click", () => {
      if (done) return;
      choisis.splice(0).forEach(c => { c.chip.disabled = false; });
      majCible();
    });
    const ok = document.createElement("button");
    ok.className = "btn-primary btn-small";
    ok.textContent = "Valider";
    ok.addEventListener("click", () => {
      if (!choisis.length) return;
      const etapes = parEtapes ? etapesAttendues(ex.reponse, ex.mots) : null;
      const correct = parEtapes
        ? JSON.stringify(choisis.map(c => normaliser(c.mot))) === JSON.stringify(etapes.map(normaliser))
        : normaliser(choisis.map(c => c.mot).join(" ")) === normaliser(ex.reponse);
      ok.disabled = true; effacer.disabled = true;
      cible.classList.add(correct ? "correct" : "incorrect");
      finish(correct, parEtapes ? etapes.join(" → ") : ex.reponse, choisis.map(c => c.mot).join(parEtapes ? " → " : " "));
    });
    majCible();
    actions.append(effacer, ok);
    card.append(cible, reserve, actions);
  } else {
    const list = document.createElement("div");
    list.className = "choix-list";
    (ex.choix || []).forEach((choix, idx) => {
      const b = document.createElement("button");
      b.className = "choix-btn";
      b.textContent = choix;
      b.addEventListener("click", () => {
        const correct = idx === ex.bonneReponse;
        list.querySelectorAll(".choix-btn").forEach((x, xi) => {
          x.disabled = true;
          if (xi === ex.bonneReponse) x.classList.add("correct");
          else if (xi === idx) x.classList.add("incorrect");
        });
        finish(correct, null, choix);
      });
      list.appendChild(b);
    });
    card.appendChild(list);
  }
  return card;
}

// Journal de toutes les réponses (historique) — écriture seule, jamais modifiée.
function journaliser({ notionId = null, correct, source, question = "", reponse = "" }) {
  if (estParent()) return;
  addDoc(collection(db, "reponsesAnglais"), {
    at: new Date().toISOString(), date: todayISO(), eleve: eleveCourant, matiere: matiereCourante, notionId, correct: !!correct, source,
    question: String(question).slice(0, 300), reponse: String(reponse ?? "").slice(0, 200),
  }).catch(err => console.error("Journal réponse", err));
}

async function enregistrerReponse(notionId, correct, { pas = 1, source = "seance", question = "", reponse = "", journal = true } = {}) {
  if (estParent()) return;
  if (journal) journaliser({ notionId, correct, source, question, reponse });
  try {
    const ref = doc(db, "progressionAnglais", notionId);
    const snap = await getDoc(ref);
    if (!snap.exists()) { console.warn("Notion introuvable pour la réponse", notionId); return; }
    const data = snap.data();
    // Une seule montée de niveau par jour : répéter un mot 5 fois dans la journée ne le rend pas « su ».
    let niveau = data.niveau || 0;
    const monte = correct && pas > 0 && data.monteLe !== todayISO();
    niveau = correct ? Math.min(niveau + (monte ? pas : 0), 5) : Math.max(niveau - 1, 0);
    const d = new Date();
    d.setDate(d.getDate() + NIVEAUX_JOURS[niveau]);
    await updateDoc(ref, {
      niveau, dernierResultat: correct,
      prochaineDate: d.toISOString().slice(0, 10),
      dernierVu: todayISO(),
      ...(monte ? { monteLe: todayISO() } : {}),
    });
  } catch (err) {
    console.error("Erreur enregistrement réponse", err);
  }
}

// ------------------------------------------------------------
// AJOUTER UN COURS
// ------------------------------------------------------------
let photosEnAttente = [];

sur("photo-input", "change", async (e) => {
  photosEnAttente = [];
  document.getElementById("photo-preview").innerHTML = "";
  for (const file of e.target.files) {
    if (file.type === "application/pdf") {
      photosEnAttente.push({ mimeType: "application/pdf", data: await fileToBase64(file) });
      const tag = document.createElement("div");
      tag.className = "pdf-tag";
      tag.textContent = `📄 ${file.name}`;
      document.getElementById("photo-preview").appendChild(tag);
      continue;
    }
    const resized = await resizeImage(file, 1600, 0.85);
    photosEnAttente.push(resized);
    const img = document.createElement("img");
    img.src = `data:${resized.mimeType};base64,${resized.data}`;
    document.getElementById("photo-preview").appendChild(img);
  }
  majBoutonsEnvoi();
});

function majBoutonsEnvoi() {
  for (const id of ["btn-envoyer-cours", "btn-envoyer-attente"]) document.getElementById(id).disabled = photosEnAttente.length === 0;
}

function viderImport() {
  photosEnAttente = [];
  document.getElementById("photo-preview").innerHTML = "";
  document.getElementById("photo-input").value = "";
}

// « Je peux attendre » : le cours et ses pages sont gardés, le cours est préparé plus tard (sans IA payante).
sur("btn-envoyer-attente", "click", async () => {
  const statusEl = document.getElementById("add-status");
  document.getElementById("btn-envoyer-cours").disabled = true;
  document.getElementById("btn-envoyer-attente").disabled = true;
  statusEl.hidden = false;
  statusEl.textContent = "Je range ton cours… 📦";
  const dictee = matiereCourante === "dictee";
  try {
    const pages = await pagesDepuisSources(photosEnAttente);
    if (!pages.length) throw new Error("Aucune page lisible");
    const dateCourte = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
    const ref = await addDoc(collection(db, "coursAnglais"), {
      eleve: eleveCourant, matiere: matiereCourante, statut: "attente",
      titre: `${dictee ? "Dictée" : "Cours"} du ${dateCourte}`,
      recap: "", vocabulaire: [], grammaire: [], dateAjout: new Date().toISOString(),
    });
    await enregistrerPagesCours(ref.id, pages);
    statusEl.textContent = `🕓 C'est noté ! ${dictee ? "Ta dictée" : "Ton cours"} (${pages.length} page${pages.length > 1 ? "s" : ""}) est en préparation : tu ${dictee ? "la" : "le"} retrouveras bientôt dans ${MATIERES_UI[matiereCourante].emoji} ${MATIERES_UI[matiereCourante].nom}.`;
    viderImport();
    loadNotions();
  } catch (err) {
    console.error(err);
    statusEl.textContent = "❌ Oups, je n'ai pas réussi à garder ce cours. Réessaie.";
  } finally {
    majBoutonsEnvoi();
  }
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function resizeImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      resolve({ mimeType: "image/jpeg", data: dataUrl.split(",")[1] });
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

sur("btn-envoyer-cours", "click", async () => {
  const statusEl = document.getElementById("add-status");
  document.getElementById("btn-envoyer-cours").disabled = true;
  document.getElementById("btn-envoyer-attente").disabled = true;
  statusEl.hidden = false;
  statusEl.textContent = "La prof IA regarde ton cours… 🧐";
  try {
    const extraireCoursAnglais = httpsCallable(functions, "extraireCoursAnglais", { timeout: 900000 });
    const result = await extraireCoursAnglais({ images: photosEnAttente, eleve: eleveCourant, matiere: matiereCourante }).then(r => r.data);
    if (matiereCourante === "dictee") dicteeChoisie = null;
    statusEl.textContent = matiereCourante === "dictee"
      ? `✅ Nouvelle dictée « ${result.titre} » : ${(result.vocabulaire || []).length} mots, dont ${(result.vocabulaire || []).filter(v => v.prioritaire).length} surlignés. Va dans 🎧 Ma dictée !`
      : `✅ Cours ajouté dans ${MATIERES_UI[matiereCourante].emoji} ${MATIERES_UI[matiereCourante].nom} : ${result.titre} (${(result.vocabulaire || []).length} ${ui().savoirCourt}, ${(result.grammaire || []).length} ${ui().regleCourt}).`;
    const sources = photosEnAttente;
    viderImport();
    loadNotions();
    loadToday();
    const pagesCours = pagesDepuisSources(sources).catch(err => { console.error("Lecture des pages", err); return []; });
    pagesCours.then(pages => enregistrerPagesCours(result.coursId, pages)).catch(err => console.error("Sauvegarde des pages", err));
  } catch (err) {
    statusEl.textContent = "❌ Oups, la prof IA n'a pas réussi à lire ce cours. Réessaie avec une photo plus nette.";
    console.error(err);
  } finally {
    majBoutonsEnvoi();
  }
});

// ------------------------------------------------------------
// MES NOTIONS
// ------------------------------------------------------------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Réponses par jour sur 14 jours : une barre par jour (hauteur = nb de réponses), détail au survol.
function graphiqueActivite(reponses) {
  if (!reponses.length) return "";
  const jours = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    jours.push(d.toISOString().slice(0, 10));
  }
  const parJour = Object.fromEntries(jours.map(j => [j, { total: 0, bonnes: 0 }]));
  reponses.forEach(r => { if (parJour[r.date]) { parJour[r.date].total += 1; if (r.correct) parJour[r.date].bonnes += 1; } });
  const max = Math.max(1, ...jours.map(j => parJour[j].total));
  const total14 = jours.reduce((s, j) => s + parJour[j].total, 0);
  const bonnes14 = jours.reduce((s, j) => s + parJour[j].bonnes, 0);
  return `<div class="activite">
    <div class="activite-head"><span class="activite-title">Activité (14 jours)</span>
      <span class="activite-sub">${total14} réponses · ${total14 ? Math.round(bonnes14 / total14 * 100) : 0}% de réussite</span></div>
    <div class="activite-bars" role="img" aria-label="Nombre de réponses par jour sur 14 jours">${jours.map(j => {
      const { total, bonnes } = parJour[j];
      const label = new Date(j + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });
      const tip = total ? `${label} : ${total} réponse${total > 1 ? "s" : ""}, ${Math.round(bonnes / total * 100)}% de réussite` : `${label} : aucune réponse`;
      const dj = new Date(j + "T12:00:00");
      const estAuj = j === todayISO();
      const lettre = ["D", "L", "M", "M", "J", "V", "S"][dj.getDay()];
      return `<div class="activite-col${estAuj ? " auj" : ""}" title="${esc(tip)}"><div class="activite-bar${total ? "" : " vide"}" style="height:${total ? Math.max(6, total / max * 100) : 2}%"></div><div class="activite-day">${estAuj ? "auj." : `${lettre}<br>${dj.getDate()}`}</div></div>`;
    }).join("")}</div>
  </div>`;
}

function marqueDerniere(n) {
  if (n.dernierResultat === true) return `<span class="last-mark ok" title="Réussie la dernière fois">✓</span>`;
  if (n.dernierResultat === false) return `<span class="last-mark ko" title="Ratée la dernière fois">✗</span>`;
  return "";
}

function statutNiveau(niveau) {
  if (niveau >= 4) return { cls: "lvl-ok", label: "Maîtrisée" };
  if (niveau >= 2) return { cls: "lvl-mid", label: "En progrès" };
  return { cls: "lvl-low", label: "À travailler" };
}

function barreNiveau(niveau) {
  return `<div class="lvl-bar">${[1, 2, 3, 4, 5].map(i => `<span class="${i <= niveau ? "on" : ""}"></span>`).join("")}</div>`;
}

async function loadNotions() {
  if (matiereCourante === "dictee") return loadDictee();
  if (matiereCourante === "tables") return loadTables();
  setTimeout(afficherBandeauControle, 1500);
  const el = document.getElementById("notions-list");
  const [progSnap, coursSnap, seancesSnap, reponsesSnap] = await Promise.all([
    getDocs(query(collection(db, "progressionAnglais"), where("eleve", "==", eleveCourant))),
    getDocs(query(collection(db, "coursAnglais"), where("eleve", "==", eleveCourant))),
    getDocs(query(collection(db, "seancesAnglais"), where("eleve", "==", eleveCourant))),
    getDocs(query(collection(db, "reponsesAnglais"), where("eleve", "==", eleveCourant))),
  ]);
  const dansMatiere = x => (x.matiere || "anglais") === matiereCourante;
  const toutesReponses = reponsesSnap.docs.map(d => d.data());
  const toutesSeances = seancesSnap.docs.map(d => d.data());
  const reponses = toutesReponses.filter(dansMatiere);
  const seances = toutesSeances.filter(dansMatiere).sort((a, b) => (b.finieLe || "").localeCompare(a.finieLe || ""));
  coursById = {};
  coursSnap.forEach(d => { if (dansMatiere(d.data())) coursById[d.id] = d.data(); });
  notionsById = {};
  progSnap.forEach(d => { if (dansMatiere(d.data())) notionsById[d.id] = { id: d.id, ...d.data() }; });
  const rows = Object.values(notionsById).sort((a, b) => (a.niveau || 0) - (b.niveau || 0) || a.label.localeCompare(b.label));
  const motivation = calculerMotivation({ reponses: toutesReponses, seances: toutesSeances, rows: Object.values(notionsById) });

  const enPreparation = Object.values(coursById).filter(c => c.statut === "attente").length;
  if (!rows.length) {
    el.innerHTML = `${enPreparation
      ? `<div class="panel-info">⏳ ${enPreparation} cours en préparation — tu le retrouveras ici bientôt.</div>`
      : `<div class="panel-info">Pas encore de cours de ${esc(ui().nom.toLowerCase())} — ajoute-en un pour commencer 📸</div>`}${htmlBadges(motivation)}`;
    await ajouterSectionFigures(el);
    return;
  }

  const grammaire = rows.filter(n => n.type === "grammaire");
  const vocab = rows.filter(n => n.type === "vocabulaire");
  const maitrisees = rows.filter(n => (n.niveau || 0) >= 4).length;
  const progres = rows.filter(n => (n.niveau || 0) >= 2 && (n.niveau || 0) < 4).length;
  const pct = Math.round(rows.reduce((s, n) => s + (n.niveau || 0), 0) / (rows.length * 5) * 100);
  const travaillees = rows.filter(n => n.dernierVu).length;
  const ratees = rows.filter(n => n.dernierResultat === false).length;
  const derniere = seances.find(s => !s.type || s.type === "jour");

  el.innerHTML = `
    <div class="notions-summary">
      <div class="ring" style="--pct:${pct}"><span>${pct}%</span></div>
      <div>
        <div class="summary-title">Ta progression</div>
        <div class="summary-stats">
          <span class="pill lvl-ok">${maitrisees} maîtrisée${maitrisees > 1 ? "s" : ""}</span>
          <span class="pill lvl-mid">${progres} en progrès</span>
          <span class="pill lvl-low">${rows.length - maitrisees - progres} à travailler</span>
        </div>
      </div>
    </div>
    <div class="stats-row">
      <div class="stat"><div class="stat-val">${seances.length}</div><div class="stat-lbl">séance${seances.length > 1 ? "s" : ""} faite${seances.length > 1 ? "s" : ""}</div></div>
      <div class="stat"><div class="stat-val">${travaillees}<span>/${rows.length}</span></div><div class="stat-lbl">notions déjà travaillées</div></div>
      <div class="stat"><div class="stat-val">${derniere ? `${derniere.score}<span>/${derniere.total}</span>` : "—"}</div><div class="stat-lbl">dernière séance</div></div>
      <div class="stat stat-alert"><div class="stat-val">${ratees}</div><div class="stat-lbl">à reprendre (✗)</div></div>
    </div>
    ${graphiqueActivite(reponses)}
    ${htmlBadges(motivation)}
    <h3 class="section-title">Cours importés <span>${Object.keys(coursById).length}</span></h3>
    <div class="cours-manage-list">${Object.entries(coursById).map(([id, c]) => `
      <div class="cours-manage-item">
        <span class="cours-manage-titre">${esc(c.titre || "Cours")}${c.statut === "attente" ? ` <span class="pill pill-attente">⏳ en préparation</span>` : ""}</span>
        <button class="btn-ghost-small" data-suppr-cours="${esc(id)}">🗑️ Supprimer</button>
      </div>`).join("")}</div>
    ${categoriesGram(grammaire).map(([cat, items], gi, arr) => {
      const estMethodes = cat === "🧭 Méthodes (toute l'année)";
      const parChapitres = ["svt", "histoire"].includes(matiereCourante) && !estMethodes;
      const parTexte = matiereCourante === "francais" && cat === "Texte";
      if (parChapitres) {
        const ouvert = gi === arr.length - 1;
        const key = `ch-${gi}`;
        return `<div class="acc-item">
          <button class="acc-head" data-acc-g="${key}" aria-expanded="${ouvert}">
            <span class="acc-name">${esc(cat)}</span>
            <span class="acc-count">${items.length}</span>
            <span class="acc-chevron">▾</span>
          </button>
          <div class="acc-body" id="acc-body-${key}" ${ouvert ? "" : "hidden"}>
            <div class="gram-grid">${items.map(carteGram).join("")}</div>
          </div>
        </div>`;
      }
      if (parTexte) {
        return items.map((n, ni) => {
          const ouvert = ni === items.length - 1;
          const key = `tx-${ni}`;
          const st = statutNiveau(n.niveau || 0);
          return `<div class="acc-item">
            <button class="acc-head" data-acc-g="${key}" aria-expanded="${ouvert}">
              <span class="acc-name">${esc(n.label)}</span>
              <span class="pill ${st.cls}">${st.label}</span>
              <span class="acc-chevron">▾</span>
            </button>
            <div class="acc-body" id="acc-body-${key}" ${ouvert ? "" : "hidden"}>
              <div class="gram-grid">${carteGram(n)}</div>
            </div>
          </div>`;
        }).join("");
      }
      return `<h3 class="section-title">${esc(cat || ui().regle)} <span>${items.length}</span></h3>
        <div class="gram-grid">${items.map(carteGram).join("")}</div>`;
    }).join("")}
    <h3 class="section-title">${esc(ui().savoir)} <span>${vocab.length}</span></h3>
    <div class="accordion">${themesVocab(vocab).map(([theme, mots], i) => {
      const pctTheme = Math.round(mots.reduce((s, n) => s + (n.niveau || 0), 0) / (mots.length * 5) * 100);
      return `<div class="acc-item">
        <button class="acc-head" data-acc="${i}" aria-expanded="false">
          <span class="acc-name">${esc(theme)}</span>
          <span class="acc-count">${mots.length} mot${mots.length > 1 ? "s" : ""}</span>
          <span class="acc-bar"><span style="width:${pctTheme}%"></span></span>
          <span class="acc-pct">${pctTheme}%</span>
          <span class="acc-chevron">▾</span>
        </button>
        <div class="acc-body" id="acc-body-${i}" hidden>
          <div class="theme-actions">${matiereCourante === "francais"
            ? `<button class="btn-primary btn-small" data-dictee-theme="${i}">🎧 Dictée sur ce thème</button>`
            : `<button class="btn-primary btn-small" data-flash="${i}">🃏 Flashcards</button><button class="btn-speed btn-small" data-speed="${i}">⚡ Jeu de vitesse</button>`}</div>
          <div class="vocab-grid">${mots.map(n => {
            const st = statutNiveau(n.niveau || 0);
            return `<button class="vocab-chip ${st.cls}" data-id="${esc(n.id)}"><span class="vocab-mot">${esc(n.label)} ${marqueDerniere(n)}</span><span class="vocab-trad">${esc(tradDe(n))}</span></button>`;
          }).join("")}</div>
        </div>
      </div>`;
    }).join("")}</div>`;

  const themes = themesVocab(vocab);
  el.querySelectorAll("[data-id]").forEach(b => b.addEventListener("click", () => openNotionModal(b.dataset.id)));
  el.querySelectorAll("[data-acc]").forEach(b => b.addEventListener("click", () => {
    const body = document.getElementById(`acc-body-${b.dataset.acc}`);
    body.hidden = !body.hidden;
    b.setAttribute("aria-expanded", String(!body.hidden));
  }));
  el.querySelectorAll("[data-acc-g]").forEach(b => b.addEventListener("click", () => {
    const body = document.getElementById(`acc-body-${b.dataset.accG}`);
    body.hidden = !body.hidden;
    b.setAttribute("aria-expanded", String(!body.hidden));
  }));
  el.querySelectorAll("[data-flash]").forEach(b => b.addEventListener("click", () => lancerFlashcards(themes[b.dataset.flash])));
  el.querySelectorAll("[data-speed]").forEach(b => b.addEventListener("click", () => lancerJeuVitesse(themes[b.dataset.speed], vocab)));
  el.querySelectorAll("[data-dictee-theme]").forEach(b => b.addEventListener("click", () => lancerDictee(new Set(themes[b.dataset.dicteeTheme][1].map(n => n.id)))));
  el.querySelectorAll("[data-suppr-cours]").forEach(b => b.addEventListener("click", () => supprimerCours(b.dataset.supprCours, b)));
  await ajouterSectionFigures(el);
}

async function supprimerCours(coursId, btn) {
  if (!btn.dataset.confirme) { btn.dataset.confirme = "1"; btn.textContent = "❓ Confirmer la suppression ?"; return; }
  btn.disabled = true;
  const notions = Object.values(notionsById).filter(n => n.coursId === coursId);
  let echecs = 0;
  try {
    for (const n of notions) {
      try { await deleteDoc(doc(db, "progressionAnglais", n.id)); } catch (err) { console.error("Échec suppression notion", n.id, n, err); echecs++; }
    }
    for (const col of ["pagesCours", "figuresRevisions"]) {
      const snap = await getDocs(query(collection(db, col), where("eleve", "==", eleveCourant), where("coursId", "==", coursId)));
      for (const d of snap.docs) {
        try { col === "figuresRevisions" ? await supprimerFigure(d.id) : await deleteDoc(d.ref); } catch (err) { console.error("Échec suppression", col, d.id, err); echecs++; }
      }
    }
    await deleteDoc(doc(db, "coursAnglais", coursId));
    loadNotions();
  } catch (err) {
    const uidConnecte = auth.currentUser?.uid || "aucun";
    console.error(err, { coursId, coursEleve: coursById[coursId]?.eleve, eleveCourant, uidConnecte });
    btn.textContent = `❌ ${err.code || err.message} — connecté=${uidConnecte} — cours.eleve=${coursById[coursId]?.eleve}`;
    btn.disabled = false;
  }
}

function tradDe(n) {
  return coursById[n.coursId]?.vocabulaire?.find(x => x.mot === n.label)?.traduction || "";
}

function dateCoursDe(n) { return coursById[n.coursId]?.dateAjout || ""; }

function carteGram(n) {
  const st = statutNiveau(n.niveau || 0);
  return `<button class="gram-card ${st.cls}" data-id="${esc(n.id)}">
    <span class="pill ${st.cls}">${st.label}</span>${marqueDerniere(n)}
    <div class="gram-card-title">${esc(n.label)}</div>
    ${barreNiveau(n.niveau || 0)}
  </button>`;
}

function categoriesGram(grammaire) {
  if (["svt", "histoire"].includes(matiereCourante)) {
    const methodes = grammaire.filter(n => n.categorie === "Méthode");
    const parChapitre = new Map();
    grammaire.filter(n => n.categorie !== "Méthode").forEach(n => {
      const c = coursById[n.coursId]?.titre || "Autre";
      if (!parChapitre.has(c)) parChapitre.set(c, []);
      parChapitre.get(c).push(n);
    });
    const groupes = [...parChapitre.entries()].sort((a, b) => dateCoursDe(a[1][0]).localeCompare(dateCoursDe(b[1][0])));
    return methodes.length ? [["🧭 Méthodes (toute l'année)", methodes], ...groupes] : groupes;
  }
  if (!grammaire.some(n => n.categorie)) return [[null, grammaire]];
  const ordre = ["Grammaire", "Conjugaison", "Orthographe", "Texte", "Méthode"];
  const map = new Map();
  grammaire.forEach(n => {
    const c = n.categorie || "Autre";
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(n);
  });
  const groupes = [...map.entries()].sort((a, b) => ordre.indexOf(a[0]) - ordre.indexOf(b[0]));
  const texte = groupes.find(([c]) => c === "Texte");
  if (texte) texte[1].sort((a, b) => dateCoursDe(a).localeCompare(dateCoursDe(b)));
  return groupes;
}

function themesVocab(vocab) {
  const map = new Map();
  vocab.forEach(n => {
    const t = n.theme || coursById[n.coursId]?.vocabulaire?.find(x => x.mot === n.label)?.theme || "Divers";
    if (!map.has(t)) map.set(t, []);
    map.get(t).push(n);
  });
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
}

function melanger(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function ouvrirLibre(html) {
  document.getElementById("modal-libre-corps").innerHTML = html;
  document.getElementById("modal-libre").hidden = false;
  return document.getElementById("modal-libre-corps");
}

let jeuTimer = null;
sur("modal-libre-close", "click", () => {
  document.getElementById("modal-libre").hidden = true;
  clearInterval(jeuTimer);
  clearInterval(tablesMinuteur);
  clearTimeout(tablesMinuteur);
  clearTimeout(dicteeMinuteur);
  if (!document.getElementById("tab-tables").hidden) loadTables();
  loadNotions();
});

// FLASHCARDS : les mots les moins maîtrisés d'abord, 20 max par série.
function lancerFlashcards([theme, mots]) {
  const paquet = [...mots].sort((a, b) => (a.niveau || 0) - (b.niveau || 0)).slice(0, 20);
  let i = 0, sus = 0;
  const corps = ouvrirLibre("");
  const afficher = () => {
    if (i >= paquet.length) {
      corps.innerHTML = `<div class="game-head hdr-vocab"><div class="modal-kicker">🃏 Flashcards · ${esc(theme)}</div><h3>Série terminée !</h3></div>
        <div class="game-body"><div class="today-score">🎉 ${sus}/${paquet.length} mots sus</div>
        <button class="btn-primary btn-block" id="fc-encore">🔁 Nouvelle série</button></div>`;
      corps.querySelector("#fc-encore").addEventListener("click", () => lancerFlashcards([theme, mots]));
      return;
    }
    const n = paquet[i];
    const v = coursById[n.coursId]?.vocabulaire?.find(x => x.mot === n.label);
    corps.innerHTML = `<div class="game-head hdr-vocab"><div class="modal-kicker">🃏 Flashcards · ${esc(theme)}</div><h3>${i + 1} / ${paquet.length}</h3></div>
      <div class="game-body">
        <div class="flashcard" id="fc-card">
          <div class="fc-face fc-front"><div class="fc-mot">${esc(n.label)}</div><div class="fc-hint">Tu connais ? Clique pour retourner</div></div>
          <div class="fc-face fc-back"><div class="fc-trad">${esc(v?.traduction || "")}</div>${v?.exemple ? `<div class="fc-ex">${esc(v.exemple)}</div>` : ""}</div>
        </div>
        <div class="fc-actions" id="fc-actions" hidden>
          <button class="fc-btn fc-non">🔁 À revoir</button>
          <button class="fc-btn fc-oui">✅ Je savais</button>
        </div>
      </div>`;
    const card = corps.querySelector("#fc-card");
    card.addEventListener("click", () => { card.classList.add("flipped"); corps.querySelector("#fc-actions").hidden = false; });
    corps.querySelector(".fc-oui").addEventListener("click", () => { sus += 1; enregistrerReponse(n.id, true, { source: "flashcards", question: n.label }); i += 1; afficher(); });
    corps.querySelector(".fc-non").addEventListener("click", () => { enregistrerReponse(n.id, false, { source: "flashcards", question: n.label }); i += 1; afficher(); });
  };
  afficher();
}

// JEU DE VITESSE : 60 s, mot français → choisir le bon mot anglais parmi 4.
function lancerJeuVitesse([theme, mots], toutVocab) {
  const pool = mots.length >= 4 ? mots : toutVocab;
  let score = 0, erreurs = 0, restant = 60, courant = null;
  const corps = ouvrirLibre(`<div class="game-head hdr-speed"><div class="modal-kicker">⚡ Jeu de vitesse · ${esc(theme)}</div>
    <h3><span id="sp-score">0</span> points</h3><div class="sp-timer"><span id="sp-bar"></span></div></div>
    <div class="game-body"><div class="sp-question" id="sp-q"></div><div class="sp-choix" id="sp-choix"></div></div>`);
  const fin = () => {
    clearInterval(jeuTimer);
    const cle = `record-vitesse-${eleveCourant}-${matiereCourante}-${theme}`;
    let record = 0;
    try { record = Number(localStorage.getItem(cle) || 0); if (score > record) localStorage.setItem(cle, String(score)); } catch {}
    if (!estParent()) addDoc(collection(db, "seancesAnglais"), {
      type: "vitesse", eleve: eleveCourant, matiere: matiereCourante, theme, date: todayISO(), score, total: score + erreurs, erreursNb: erreurs, finieLe: new Date().toISOString(),
    }).catch(err => console.error("Enregistrement jeu", err));
    corps.querySelector(".game-body").innerHTML = `<div class="today-score">⏱️ Temps écoulé ! ${score} bonne${score > 1 ? "s" : ""} réponse${score > 1 ? "s" : ""}, ${erreurs} erreur${erreurs > 1 ? "s" : ""}</div>
      <p class="sp-record">${score > record ? "🏆 Nouveau record !" : `Record : ${record}`}</p>
      <button class="btn-primary btn-block" id="sp-rejouer">🔁 Rejouer</button>`;
    corps.querySelector("#sp-rejouer").addEventListener("click", () => lancerJeuVitesse([theme, mots], toutVocab));
  };
  const suivante = () => {
    courant = pool[Math.floor(Math.random() * pool.length)];
    const leurres = melanger(pool.filter(n => n.label !== courant.label)).slice(0, 3);
    corps.querySelector("#sp-q").textContent = tradDe(courant);
    const zone = corps.querySelector("#sp-choix");
    zone.innerHTML = "";
    melanger([courant, ...leurres]).forEach(n => {
      const b = document.createElement("button");
      b.className = "choix-btn";
      b.textContent = n.label;
      b.addEventListener("click", () => {
        if (restant <= 0) return;
        const ok = n.label === courant.label;
        const trace = { source: "vitesse", question: tradDe(courant), reponse: n.label };
        if (ok) { score += 1; journaliser({ notionId: courant.id, correct: true, ...trace }); }
        else { erreurs += 1; enregistrerReponse(courant.id, false, trace); }
        b.classList.add(ok ? "correct" : "incorrect");
        corps.querySelector("#sp-score").textContent = score;
        setTimeout(suivante, ok ? 250 : 700);
      });
      zone.appendChild(b);
    });
  };
  clearInterval(jeuTimer);
  jeuTimer = setInterval(() => {
    restant -= 1;
    corps.querySelector("#sp-bar").style.width = `${(restant / 60) * 100}%`;
    if (restant <= 0) fin();
  }, 1000);
  suivante();
}

// ------------------------------------------------------------
// CHANSONS
// ------------------------------------------------------------
function youtubeIdDe(url) {
  const m = String(url || "").match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : "";
}

async function loadChansons() {
  const el = document.getElementById("songs-list");
  const snap = await getDocs(query(collection(db, "chansonsAnglais"), where("eleve", "==", eleveCourant)));
  const chansons = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.dateAjout || "").localeCompare(a.dateAjout || ""));
  if (!chansons.length) {
    el.innerHTML = `<div class="panel-info">Pas encore de chanson — ajoute ta préférée ci-dessus 🎶</div>`;
    return;
  }
  el.innerHTML = chansons.map((c, i) => `<button class="song-card" data-song="${i}">
    ${c.youtubeId ? `<img src="https://i.ytimg.com/vi/${esc(c.youtubeId)}/mqdefault.jpg" alt="">` : `<div class="song-noimg">🎵</div>`}
    <div class="song-info"><div class="song-titre">${esc(c.titre)}</div><div class="song-artiste">${esc(c.artiste)}</div></div>
  </button>`).join("");
  el.querySelectorAll("[data-song]").forEach(b => b.addEventListener("click", () => ouvrirChanson(chansons[b.dataset.song])));
}

// Rend un texte avec chaque mot cliquable (traduction au clic) et les expressions annotées surlignées.
function motsCliquables(texte, expressions = []) {
  const bas = texte.toLowerCase();
  const zones = expressions.map(e => { const i = bas.indexOf(String(e).toLowerCase()); return i >= 0 ? [i, i + String(e).length] : null; }).filter(Boolean);
  const dansZone = (a, b) => zones.some(([z0, z1]) => a >= z0 && b <= z1);
  let html = "";
  let pos = 0;
  for (const m of texte.matchAll(/[A-Za-z][A-Za-z'’-]*/g)) {
    html += esc(texte.slice(pos, m.index));
    const fin = m.index + m[0].length;
    html += `<span class="mot${dansZone(m.index, fin) ? " mot-expr" : ""}" data-mot="${esc(m[0])}">${esc(m[0])}</span>`;
    pos = fin;
  }
  return html + esc(texte.slice(pos));
}

const popMot = document.createElement("div");
popMot.className = "pop-mot";
popMot.hidden = true;
document.body.appendChild(popMot);

document.addEventListener("click", async (e) => {
  const cible = e.target.closest(".mot");
  if (!cible) { if (!e.target.closest(".pop-mot")) popMot.hidden = true; return; }
  const mot = cible.dataset.mot;
  const contexte = (cible.closest(".paroles-ligne, .ce-texte")?.textContent || "").slice(0, 200);
  const r = cible.getBoundingClientRect();
  popMot.style.left = `${Math.min(window.innerWidth - 250, Math.max(8, r.left + window.scrollX))}px`;
  popMot.style.top = `${r.bottom + window.scrollY + 6}px`;
  popMot.innerHTML = `<div class="pop-titre">${esc(mot)}</div><div class="pop-load">…</div>`;
  popMot.hidden = false;
  try {
    const traduireMotAnglais = httpsCallable(functions, "traduireMotAnglais", { timeout: 60000 });
    const t = await traduireMotAnglais({ mot, contexte }).then(res => res.data);
    if (popMot.querySelector(".pop-titre")?.textContent !== mot) return;
    popMot.innerHTML = `<div class="pop-titre">${esc(mot)} <span class="pop-nature">${esc(t.nature)}</span></div>
      <div class="pop-trad">${esc(t.traduction)}</div>
      ${t.base && t.base.toLowerCase() !== mot.toLowerCase() ? `<div class="pop-base">forme de base : <strong>${esc(t.base)}</strong></div>` : ""}
      ${t.note ? `<div class="pop-note">${esc(t.note)}</div>` : ""}`;
  } catch (err) {
    console.error(err);
    popMot.innerHTML = `<div class="pop-titre">${esc(mot)}</div><div class="pop-note">Traduction indisponible pour l'instant.</div>`;
  }
});

function htmlParoles(c) {
  if (!c.paroles) return "";
  const parLigne = {};
  (c.annotations || []).forEach(a => { if (!parLigne[a.ligne]) parLigne[a.ligne] = []; parLigne[a.ligne].push(a); });
  return `<div class="exemples-title">Paroles &amp; explications <span class="astuce">· clique sur un mot pour sa traduction</span></div>
    <div class="paroles">${c.paroles.split("\n").map((ligne, i) => {
      const notes = parLigne[i] || [];
      return `<div class="paroles-row${ligne.trim() ? "" : " blank"}">
        <div class="paroles-ligne">${motsCliquables(ligne, notes.map(n => n.expression)) || "&nbsp;"}</div>
        <div class="paroles-notes">${notes.map(n => `<div class="note"><span class="note-expr">${esc(n.expression)}</span> = ${esc(n.sens)}${n.explication ? `<div class="note-expl">${esc(n.explication)}</div>` : ""}</div>`).join("")}</div>
      </div>`;
    }).join("")}</div>`;
}

function ouvrirChanson(c) {
  const corps = ouvrirLibre(`<div class="game-head hdr-song"><div class="modal-kicker">🎵 ${esc(c.artiste)}</div><h3>${esc(c.titre)}</h3></div>
    <div class="game-body">
      ${c.youtubeId ? `<div class="video-wrap"><iframe src="https://www.youtube-nocookie.com/embed/${esc(c.youtubeId)}" title="${esc(c.titre)}" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>` : `<div class="panel-info">Pas encore de vidéo : ajoute un lien YouTube ci-dessous ✏️</div>`}
      ${c.resume ? `<div class="regle-box"><div class="regle-title">De quoi ça parle ?</div>${esc(c.resume)}${c.contexte ? `<p class="song-contexte">${esc(c.contexte)}</p>` : ""}</div>` : ""}
      ${htmlParoles(c)}
      ${!c.paroles && (c.expressions || []).length ? `<div class="exemples-title">Expressions à retenir</div>
        ${c.expressions.map(x => `<div class="expr-card"><div class="expr-en">${esc(x.expression)}</div><div class="expr-fr">${esc(x.sens)}</div>${x.explication ? `<div class="expr-expl">${esc(x.explication)}</div>` : ""}</div>`).join("")}` : ""}
      ${(c.questions || []).length ? `<div class="exemples-title">As-tu bien compris ?</div><div id="song-questions"></div>` : ""}
      <details class="song-edit">
        <summary>✏️ ${c.paroles ? "Modifier" : "Ajouter"} la vidéo ou les paroles</summary>
        <input type="url" id="edit-song-url" placeholder="Lien YouTube" value="${c.youtubeId ? `https://youtu.be/${esc(c.youtubeId)}` : ""}">
        <textarea id="edit-song-paroles" rows="8" placeholder="Colle ici les paroles depuis un site de paroles, une ligne par vers">${esc(c.paroles || "")}</textarea>
        <button class="btn-primary btn-small" id="btn-save-song">Enregistrer</button>
        <p class="muted" id="edit-song-status" hidden></p>
      </details>
    </div>`);
  const zone = corps.querySelector("#song-questions");
  (c.questions || []).forEach(q => zone?.appendChild(renderExercise(q, {
    onAnswered: (correct, donnee) => journaliser({ correct, source: "chanson", question: q.question, reponse: donnee }),
  })));

  corps.querySelector("#btn-save-song").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const status = corps.querySelector("#edit-song-status");
    const url = corps.querySelector("#edit-song-url").value.trim();
    const youtubeId = youtubeIdDe(url);
    status.hidden = false;
    if (url && !youtubeId) { status.textContent = "Ce lien YouTube n'est pas reconnu."; return; }
    const paroles = corps.querySelector("#edit-song-paroles").value;
    const parolesChangees = paroles.trim() !== (c.paroles || "").trim();
    btn.disabled = true;
    status.textContent = parolesChangees ? "La prof IA annote les paroles… 🎧" : "Enregistrement…";
    try {
      const ficheChansonAnglais = httpsCallable(functions, "ficheChansonAnglais", { timeout: 180000 });
      await ficheChansonAnglais({ id: c.id, eleve: eleveCourant, youtubeId, ...(parolesChangees ? { paroles } : {}) });
      const snap = await getDoc(doc(db, "chansonsAnglais", c.id));
      ouvrirChanson({ id: c.id, ...snap.data() });
      loadChansons();
    } catch (err) {
      console.error(err);
      status.textContent = "❌ Échec de l'enregistrement. Réessaie.";
      btn.disabled = false;
    }
  });
}

sur("btn-add-song", "click", async () => {
  const titre = document.getElementById("song-titre").value.trim();
  const artiste = document.getElementById("song-artiste").value.trim();
  const url = document.getElementById("song-url").value.trim();
  const status = document.getElementById("song-status");
  const youtubeId = youtubeIdDe(url);
  status.hidden = false;
  if (!titre) { status.textContent = "Indique au moins le titre."; return; }
  if (url && !youtubeId) { status.textContent = "Ce lien YouTube n'est pas reconnu."; return; }
  const btn = document.getElementById("btn-add-song");
  btn.disabled = true;
  status.textContent = "La prof IA prépare la fiche de la chanson… 🎧";
  try {
    const ficheChansonAnglais = httpsCallable(functions, "ficheChansonAnglais", { timeout: 180000 });
    await ficheChansonAnglais({ eleve: eleveCourant, titre, artiste, youtubeId, paroles: document.getElementById("song-paroles").value });
    status.textContent = "✅ Chanson ajoutée !";
    ["song-titre", "song-artiste", "song-url", "song-paroles"].forEach(id => { document.getElementById(id).value = ""; });
    loadChansons();
  } catch (err) {
    console.error(err);
    status.textContent = err?.code === "functions/not-found"
      ? "🤔 La prof IA ne connaît pas assez cette chanson pour faire une fiche fiable."
      : "❌ Impossible de créer la fiche. Réessaie dans un instant.";
  } finally {
    btn.disabled = false;
  }
});

let modalNotionId = null;

async function openNotionModal(notionId) {
  let notion = notionsById[notionId];
  if (!notion) {
    const snap = await getDoc(doc(db, "progressionAnglais", notionId));
    if (!snap.exists()) return;
    notion = { id: notionId, ...snap.data() };
  }
  let cours = coursById[notion.coursId];
  if (!cours) {
    const coursSnap = await getDoc(doc(db, "coursAnglais", notion.coursId));
    cours = coursSnap.exists() ? coursSnap.data() : null;
  }

  const st = statutNiveau(notion.niveau || 0);
  const isVocab = notion.type === "vocabulaire";
  const header = document.getElementById("modal-header");
  header.className = `modal-header ${isVocab ? "hdr-vocab" : "hdr-gram"}`;
  header.innerHTML = `
    <div class="modal-kicker">${isVocab ? "🔤 Vocabulaire" : "📐 Grammaire"}${cours?.titre ? ` · ${esc(cours.titre)}` : ""}</div>
    <h3>${esc(notion.label)}</h3>
    <div class="modal-level"><span class="pill ${st.cls}">${st.label}</span>${barreNiveau(notion.niveau || 0)}</div>`;

  const corps = document.getElementById("modal-corps");
  if (isVocab) {
    const v = cours?.vocabulaire?.find(x => x.mot === notion.label);
    corps.innerHTML = v
      ? `<div class="regle-box"><div class="vocab-big">${esc(v.mot)}</div><div class="vocab-big-trad">${esc(v.traduction)}</div></div>
         ${v.exemple ? `<div class="exemples-title">Exemple</div><div class="exemple-card">${esc(v.exemple)}</div>` : ""}`
      : `<div class="regle-box">${esc(notion.label)}</div>`;
  } else {
    const g = cours?.grammaire?.find(x => x.titre === notion.label);
    corps.innerHTML = g
      ? `<div class="regle-box"><div class="regle-title">La règle</div>${esc(g.explication)}</div>
         ${(g.exemples || []).length ? `<div class="exemples-title">Exemples</div>${g.exemples.map(ex => `<div class="exemple-card">${esc(ex)}</div>`).join("")}` : ""}`
      : `<div class="regle-box">${esc(notion.label)}</div>`;
  }
  modalNotionId = notionId;
  corps.insertAdjacentHTML("beforeend", `<div id="notion-historique"></div>`);
  afficherHistoriqueNotion(notionId);
  document.getElementById("modal-exos").innerHTML = "";
  const btn = document.getElementById("btn-entrainer");
  btn.hidden = false;
  btn.disabled = false;
  document.getElementById("modal-notion").hidden = false;
}

const SOURCES_LIBELLES = { seance: "Séance", entrainement: "Entraînement", flashcards: "Flashcards", vitesse: "Jeu de vitesse", comprehension: "Écoute" };

async function afficherHistoriqueNotion(notionId) {
  const zone = document.getElementById("notion-historique");
  try {
    const snap = await getDocs(query(collection(db, "reponsesAnglais"), where("eleve", "==", eleveCourant), where("notionId", "==", notionId)));
    if (notionId !== modalNotionId || !zone.isConnected) return;
    const lignes = snap.docs.map(d => d.data()).sort((a, b) => b.at.localeCompare(a.at));
    if (!lignes.length) {
      zone.innerHTML = `<div class="exemples-title">Historique</div><p class="muted histo-vide">Pas encore travaillée.</p>`;
      return;
    }
    const ok = lignes.filter(l => l.correct).length;
    zone.innerHTML = `<div class="exemples-title">Historique · ${ok}/${lignes.length} réussies</div>
      <div class="histo-points">${[...lignes].reverse().slice(-20).map(l => `<span class="histo-point ${l.correct ? "ok" : "ko"}" title="${esc(new Date(l.at).toLocaleDateString("fr-FR"))} · ${esc(SOURCES_LIBELLES[l.source] || l.source)}"></span>`).join("")}</div>
      <div class="histo-liste">${lignes.slice(0, 6).map(l => `<div class="histo-ligne">
        <span class="last-mark ${l.correct ? "ok" : "ko"}">${l.correct ? "✓" : "✗"}</span>
        <span class="histo-date">${esc(new Date(l.at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }))}</span>
        <span class="histo-src">${esc(SOURCES_LIBELLES[l.source] || l.source)}</span>
        ${l.reponse ? `<span class="histo-rep">« ${esc(l.reponse)} »</span>` : ""}
      </div>`).join("")}</div>`;
  } catch (err) {
    console.error("Historique notion", err);
  }
}

sur("btn-entrainer", "click", async () => {
  const btn = document.getElementById("btn-entrainer");
  const zone = document.getElementById("modal-exos");
  const notionId = modalNotionId;
  btn.disabled = true;
  zone.innerHTML = `<div class="loading-exos">✍️ La prof IA prépare tes exercices…</div>`;
  try {
    const exercicesNotionAnglais = httpsCallable(functions, "exercicesNotionAnglais", { timeout: 120000 });
    const { exercices } = await exercicesNotionAnglais({ notionId, eleve: eleveCourant }).then(r => r.data);
    if (notionId !== modalNotionId) return;
    btn.hidden = true;
    zone.innerHTML = `<div class="exemples-title">Entraînement</div>`;
    let bonnes = 0, repondues = 0;
    exercices.forEach((ex) => {
      zone.appendChild(renderExercise(ex, {
        onAnswered: (correct, donnee) => {
          repondues += 1;
          if (correct) bonnes += 1;
          journaliser({ notionId, correct, source: "entrainement", question: ex.phrase || ex.question || "", reponse: donnee });
          if (repondues < exercices.length) return;
          const parfait = bonnes === exercices.length;
          const reussi = bonnes >= Math.ceil(exercices.length * 0.75);
          enregistrerReponse(notionId, reussi, { pas: parfait ? 2 : 1, source: "entrainement", journal: false }).then(loadNotions);
          const fin = document.createElement("div");
          fin.className = `today-score ${reussi ? "" : "score-low"}`;
          fin.textContent = parfait
            ? `🏆 ${bonnes}/${exercices.length} — parfait ! La notion avance de 2 crans.`
            : reussi
              ? `🎉 ${bonnes}/${exercices.length} — bien joué, la notion progresse !`
              : `${bonnes}/${exercices.length} — on la reverra bientôt, courage 💪`;
          const encore = document.createElement("button");
          encore.className = "btn-ghost-small";
          encore.textContent = "🔁 Encore une série";
          encore.addEventListener("click", () => { btn.hidden = false; btn.click(); });
          zone.append(fin, encore);
        },
      }));
    });
  } catch (err) {
    console.error(err);
    zone.innerHTML = `<p class="muted">Oups, impossible de générer les exercices. Réessaie dans un instant.</p>`;
    btn.disabled = false;
  }
});

sur("modal-close", "click", () => {
  document.getElementById("modal-notion").hidden = true;
  modalNotionId = null;
});


// ------------------------------------------------------------
// MOTIVATION : série de jours + badges
// ------------------------------------------------------------
function calculerMotivation({ reponses, seances, rows }) {
  const jours = new Set(reponses.map(r => r.date));
  let serie = 0;
  const d = new Date();
  if (!jours.has(todayISO())) d.setDate(d.getDate() - 1);
  while (jours.has(d.toISOString().slice(0, 10))) { serie += 1; d.setDate(d.getDate() - 1); }
  const maitrisees = rows.filter(n => (n.niveau || 0) >= 4).length;
  const seancesJour = seances.filter(s => !s.type || s.type === "jour");
  const meilleurJeu = Math.max(0, ...seances.filter(s => s.type === "vitesse").map(s => s.score || 0));
  const sources = new Set(reponses.map(r => r.source));
  const badges = [
    { id: "premiere", emoji: "🌱", nom: "Première séance", ok: seancesJour.length >= 1 },
    { id: "sansfaute", emoji: "🏆", nom: "Sans-faute", ok: seancesJour.some(s => s.total && s.score === s.total) },
    { id: "serie3", emoji: "🔥", nom: "3 jours d'affilée", ok: serie >= 3 },
    { id: "serie7", emoji: "⚡", nom: "7 jours d'affilée", ok: serie >= 7 },
    { id: "serie30", emoji: "👑", nom: "30 jours d'affilée", ok: serie >= 30 },
    { id: "m10", emoji: "⭐", nom: "10 notions maîtrisées", ok: maitrisees >= 10 },
    { id: "m50", emoji: "🌟", nom: "50 notions maîtrisées", ok: maitrisees >= 50 },
    { id: "m100", emoji: "💫", nom: "100 notions maîtrisées", ok: maitrisees >= 100 },
    { id: "r100", emoji: "💯", nom: "100 réponses", ok: reponses.length >= 100 },
    { id: "r500", emoji: "🚀", nom: "500 réponses", ok: reponses.length >= 500 },
    { id: "vitesse15", emoji: "🏎️", nom: "15 au jeu de vitesse", ok: meilleurJeu >= 15 },
    { id: "voix", emoji: "🎤", nom: "Première prononciation", ok: sources.has("prononciation") },
    { id: "dictee", emoji: "✍️", nom: "Première dictée", ok: sources.has("dictee") },
    { id: "controle", emoji: "📝", nom: "Premier contrôle blanc", ok: sources.has("controle") },
    { id: "chanson", emoji: "🎵", nom: "Première chanson", ok: sources.has("chanson") },
  ];
  majSerie(serie, jours.has(todayISO()));
  annoncerNouveauxBadges(badges.filter(b => b.ok).map(b => b.id), badges);
  return { serie, badges };
}

function majSerie(serie, faitAujourdhui) {
  const el = document.getElementById("streak");
  el.hidden = serie === 0;
  el.className = `streak${faitAujourdhui ? "" : " streak-attente"}`;
  el.textContent = `🔥 ${serie}`;
  el.title = faitAujourdhui ? `${serie} jour(s) d'affilée` : `${serie} jour(s) d'affilée — fais ta séance aujourd'hui pour continuer !`;
}

function annoncerNouveauxBadges(obtenus, badges) {
  let vus = null;
  try { vus = JSON.parse(localStorage.getItem(`badges-vus-${eleveCourant}`) || "null"); } catch {}
  try { localStorage.setItem(`badges-vus-${eleveCourant}`, JSON.stringify(obtenus)); } catch {}
  if (!vus) return;
  obtenus.filter(id => !vus.includes(id)).forEach((id, i) => {
    const b = badges.find(x => x.id === id);
    setTimeout(() => toast(`${b.emoji} Nouveau badge : ${b.nom} !`), i * 1800);
  });
}

function toast(texte) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = texte;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("toast-out"), 3200);
  setTimeout(() => t.remove(), 3800);
}

function htmlBadges({ serie, badges }) {
  const n = badges.filter(b => b.ok).length;
  return `<h3 class="section-title">🏅 Badges <span>${n}/${badges.length}</span>${serie ? ` <span class="serie-pill">🔥 ${serie} jour${serie > 1 ? "s" : ""} d'affilée</span>` : ""}</h3>
    <div class="badges">${badges.map(b => `<div class="badge${b.ok ? " ok" : ""}" title="${esc(b.nom)}"><span class="badge-emoji">${b.ok ? b.emoji : "🔒"}</span><span class="badge-nom">${esc(b.nom)}</span></div>`).join("")}</div>`;
}

// ------------------------------------------------------------
// S'ENTRAÎNER : phrases d'exemple des cours (prononciation, dictée)
// ------------------------------------------------------------
function phrasesEntrainement(n = 8, idsFiltre = null) {
  const pool = [];
  Object.values(notionsById).forEach(no => {
    if (idsFiltre && !idsFiltre.has(no.id)) return;
    const cours = coursById[no.coursId];
    if (!cours) return;
    const ex = no.type === "vocabulaire"
      ? [cours.vocabulaire?.find(x => x.mot === no.label)?.exemple]
      : (cours.grammaire?.find(x => x.titre === no.label)?.exemples || []);
    ex.filter(Boolean).forEach(texte => {
      const nb = texte.split(/\s+/).length;
      if (nb >= 3 && nb <= 16) pool.push({ notionId: no.id, texte, niveau: no.niveau || 0, rate: no.dernierResultat === false ? 1 : 0 });
    });
  });
  const tries = melanger(pool).sort((a, b) => (b.rate - a.rate) || (a.niveau - b.niveau)).slice(0, n * 3);
  return melanger(tries).slice(0, n);
}

function motsDe(s) { return normaliser(s).split(" ").filter(Boolean); }

// Découpe le texte attendu d'un exercice "ordre par étapes" en retrouvant chaque étape
// connue (ex.mots) dans ex.reponse, plutôt que de couper bêtement sur "|" : une étape
// peut elle-même contenir un "|" (ex. "768 | événement"), ce qui rendrait un simple split ambigu.
function etapesAttendues(reponse, mots) {
  const texte = String(reponse || "");
  const valides = (mots || []).filter(Boolean);
  if (valides.length) {
    const echap = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const trouves = texte.match(new RegExp(valides.map(echap).join("|"), "g")) || [];
    if (trouves.length === valides.length) return trouves;
  }
  return texte.split("|").map((s) => s.trim());
}

function comparerMots(attendu, donne) {
  const restant = motsDe(donne);
  const resultat = motsDe(attendu).map(m => {
    const i = restant.indexOf(m);
    if (i >= 0) { restant.splice(i, 1); return { m, ok: true }; }
    return { m, ok: false };
  });
  return { resultat, taux: resultat.length ? resultat.filter(x => x.ok).length / resultat.length : 0 };
}

function dire(texte, rate = 0.95, langue = langueMatiere(matiereCourante)) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texte);
  const v = voixPour(langue);
  if (v) u.voice = v;
  u.lang = v?.lang || CODES_LANGUE[langue] || "fr-FR";
  u.rate = rate;
  speechSynthesis.speak(u);
}

function finEntrainement(corps, titre, bonnes, total, relancer) {
  corps.querySelector(".game-body").innerHTML = `<div class="today-score${bonnes / total >= 0.7 ? "" : " score-low"}">${titre} : ${bonnes}/${total}</div>
    <button class="btn-primary btn-block" id="tr-encore">🔁 Encore une série</button>`;
  corps.querySelector("#tr-encore").addEventListener("click", relancer);
  loadNotions();
}

// PRONONCIATION
sur("btn-pron", "click", lancerPrononciation);

function lancerPrononciation() {
  const Reco = window.SpeechRecognition || window.webkitSpeechRecognition;
  const corps = ouvrirLibre(`<div class="game-head hdr-pron"><div class="modal-kicker">🎤 Prononciation</div><h3 id="pr-compteur"></h3></div><div class="game-body"></div>`);
  if (!Reco) {
    corps.querySelector(".game-body").innerHTML = `<div class="panel-info">La reconnaissance vocale n'est pas disponible sur ce navigateur. Utilise Chrome (ordinateur ou Android) ou Safari sur un iPhone récent.</div>`;
    return;
  }
  const phrases = phrasesEntrainement(8);
  if (!phrases.length) { corps.querySelector(".game-body").innerHTML = `<div class="panel-info">Ajoute d'abord un cours 📸</div>`; return; }
  let i = 0, bonnes = 0;
  const afficher = () => {
    if (i >= phrases.length) return finEntrainement(corps, "🎤 Phrases bien prononcées", bonnes, phrases.length, lancerPrononciation);
    const p = phrases[i];
    corps.querySelector("#pr-compteur").textContent = `${i + 1} / ${phrases.length}`;
    corps.querySelector(".game-body").innerHTML = `
      <div class="pr-phrase">${motsCliquables(p.texte)}</div>
      <div class="pr-actions">
        <button class="btn-ghost-small" id="pr-ecouter">🔊 Écouter le modèle</button>
        <button class="pr-micro" id="pr-micro">🎤</button>
      </div>
      <div class="pr-etat muted" id="pr-etat">Appuie sur le micro et lis la phrase à voix haute.</div>
      <div id="pr-resultat"></div>`;
    corps.querySelector("#pr-ecouter").addEventListener("click", () => dire(p.texte));
    let essais = 0;
    corps.querySelector("#pr-micro").addEventListener("click", (e) => {
      const micro = e.currentTarget;
      const reco = new Reco();
      reco.lang = "en-GB";
      reco.interimResults = false;
      reco.maxAlternatives = 3;
      micro.classList.add("ecoute");
      corps.querySelector("#pr-etat").textContent = "Je t'écoute…";
      reco.onresult = (ev) => {
        const alternatives = [...ev.results[0]].map(a => a.transcript);
        const meilleur = alternatives.map(t => ({ t, ...comparerMots(p.texte, t) })).sort((a, b) => b.taux - a.taux)[0];
        essais += 1;
        const ok = meilleur.taux >= 0.8;
        const fini = ok || essais >= 3;
        corps.querySelector("#pr-etat").textContent = "";
        corps.querySelector("#pr-resultat").innerHTML = `
          <div class="pr-mots">${meilleur.resultat.map(x => `<span class="${x.ok ? "pm-ok" : "pm-ko"}">${esc(x.m)}</span>`).join(" ")}</div>
          <div class="pr-entendu">J'ai entendu : « ${esc(meilleur.t)} »</div>
          <div class="pr-verdict ${ok ? "ok" : "ko"}">${ok ? "✅ Bien prononcé !" : fini ? "On passe à la suite, cette phrase reviendra." : "🔁 Pas tout à fait : écoute le modèle et réessaie (mots en rouge)."}</div>
          ${fini ? `<button class="btn-primary btn-block" id="pr-suivant">Phrase suivante →</button>` : ""}`;
        if (fini) {
          enregistrerReponse(p.notionId, ok, { source: "prononciation", question: p.texte, reponse: meilleur.t });
          if (ok) bonnes += 1;
          corps.querySelector("#pr-suivant").addEventListener("click", () => { i += 1; afficher(); });
        }
      };
      reco.onerror = (ev) => {
        corps.querySelector("#pr-etat").textContent = ev.error === "not-allowed"
          ? "Autorise l'accès au micro dans le navigateur, puis réessaie."
          : "Je n'ai rien entendu, réessaie.";
      };
      reco.onend = () => { micro.classList.remove("ecoute"); };
      reco.start();
    });
  };
  afficher();
}

// DICTÉE
sur("btn-dictee", "click", () => lancerDictee());

function lancerDictee(idsFiltre = null) {
  const phrases = phrasesEntrainement(6, idsFiltre);
  const corps = ouvrirLibre(`<div class="game-head hdr-dictee"><div class="modal-kicker">✍️ Dictée</div><h3 id="di-compteur"></h3></div><div class="game-body"></div>`);
  if (!phrases.length) { corps.querySelector(".game-body").innerHTML = `<div class="panel-info">Ajoute d'abord un cours 📸</div>`; return; }
  let i = 0, bonnes = 0;
  const afficher = () => {
    if (i >= phrases.length) return finEntrainement(corps, "✍️ Phrases sans faute", bonnes, phrases.length, () => lancerDictee(idsFiltre));
    const p = phrases[i];
    corps.querySelector("#di-compteur").textContent = `${i + 1} / ${phrases.length}`;
    corps.querySelector(".game-body").innerHTML = `
      <div class="pr-actions">
        <button class="pr-micro di-play" id="di-play">🔊</button>
        <button class="btn-ghost-small" id="di-lent">🐢 Plus lentement</button>
      </div>
      <textarea id="di-saisie" class="di-saisie" rows="2" placeholder="Écris ce que tu entends…" autocapitalize="off" spellcheck="false"></textarea>
      <button class="btn-primary btn-block" id="di-valider">Valider</button>
      <div id="di-resultat"></div>`;
    corps.querySelector("#di-play").addEventListener("click", () => dire(p.texte));
    corps.querySelector("#di-lent").addEventListener("click", () => dire(p.texte, 0.65));
    setTimeout(() => dire(p.texte), 300);
    corps.querySelector("#di-valider").addEventListener("click", (e) => {
      const saisie = corps.querySelector("#di-saisie").value.trim();
      if (!saisie) return;
      const { resultat, taux } = comparerMots(p.texte, saisie);
      const ok = taux === 1 && motsDe(saisie).length === motsDe(p.texte).length;
      if (ok) bonnes += 1;
      enregistrerReponse(p.notionId, ok, { source: "dictee", question: p.texte, reponse: saisie });
      e.currentTarget.remove();
      corps.querySelector("#di-saisie").disabled = true;
      corps.querySelector("#di-resultat").innerHTML = `
        <div class="pr-verdict ${ok ? "ok" : "ko"}">${ok ? "✅ Parfait !" : `${Math.round(taux * 100)} % des mots justes`}</div>
        <div class="di-correction"><span class="muted">La phrase :</span> ${resultat.map(x => `<span class="${x.ok ? "pm-ok" : "pm-ko"}">${esc(x.m)}</span>`).join(" ")}</div>
        <button class="btn-primary btn-block" id="di-suivant">Phrase suivante →</button>`;
      corps.querySelector("#di-suivant").addEventListener("click", () => { i += 1; afficher(); });
    });
  };
  afficher();
}

// CONTRÔLE BLANC
sur("btn-controle", "click", async () => {
  if (!Object.keys(coursById).length) await loadNotions();
  const cours = Object.entries(coursById).sort((a, b) => (b[1].dateAjout || "").localeCompare(a[1].dateAjout || ""));
  const corps = ouvrirLibre(`<div class="game-head hdr-controle"><div class="modal-kicker">📝 Contrôle blanc</div><h3>Quel cours réviser ?</h3></div>
    <div class="game-body">${cours.length ? cours.map(([id, c]) => `<button class="cours-choix" data-cours="${esc(id)}"><span>${esc(c.titre)}</span><span class="muted">${(c.vocabulaire || []).length} ${ui().savoirCourt} · ${(c.grammaire || []).length} ${ui().regleCourt}</span></button>`).join("") : `<div class="panel-info">Ajoute d'abord un cours 📸</div>`}</div>`);
  corps.querySelectorAll("[data-cours]").forEach(b => b.addEventListener("click", () => lancerControle(b.dataset.cours)));
});

async function lancerControle(coursId) {
  const corps = ouvrirLibre(`<div class="game-head hdr-controle"><div class="modal-kicker">📝 Contrôle blanc</div><h3>${esc(coursById[coursId]?.titre || "")}</h3></div>
    <div class="game-body"><div class="loading-exos">✍️ La prof IA prépare ton contrôle… (environ une minute)</div></div>`);
  try {
    const controleCoursAnglais = httpsCallable(functions, "controleCoursAnglais", { timeout: 240000 });
    const { exercices } = await controleCoursAnglais({ coursId, eleve: eleveCourant }).then(r => r.data);
    const body = corps.querySelector(".game-body");
    body.innerHTML = `<p class="muted">${exercices.length} questions, comme en classe. Les explications s'affichent après chaque réponse.</p>`;
    let repondues = 0, bonnes = 0;
    const erreurs = [];
    exercices.forEach((ex, idx) => {
      const titre = document.createElement("div");
      titre.className = "exemples-title";
      titre.textContent = `Question ${idx + 1}`;
      body.appendChild(titre);
      body.appendChild(renderExercise(ex, {
        onAnswered: (correct, donnee) => {
          repondues += 1;
          if (correct) bonnes += 1; else if (ex.notionId) erreurs.push(ex.notionId);
          if (ex.notionId) enregistrerReponse(ex.notionId, correct, { source: "controle", question: ex.phrase || ex.question || "", reponse: donnee });
          else journaliser({ correct, source: "controle", question: ex.question || "", reponse: donnee });
          if (repondues < exercices.length) return;
          const note = Math.round(bonnes / exercices.length * 20 * 2) / 2;
          const fin = document.createElement("div");
          fin.className = "bilan";
          fin.innerHTML = `<div class="bilan-head"><div class="bilan-score">${String(note).replace(".", ",")}<span>/20</span></div>
            <div><div class="bilan-msg">${note >= 16 ? "🏆 Prête pour le contrôle !" : note >= 12 ? "👍 Bien, encore un petit effort" : "💪 À retravailler avant le contrôle"}</div>
            <div class="bilan-sub">${bonnes} bonnes réponses sur ${exercices.length}</div></div></div>
            ${erreurs.length ? `<div class="exemples-title">À revoir</div><div class="bilan-erreurs">${[...new Set(erreurs)].map(id => `<button class="bilan-erreur" data-revoir="${esc(id)}"><span>${esc(notionsById[id]?.label || id)}</span><span class="bilan-go">💡 Revoir</span></button>`).join("")}</div>` : ""}
            <div class="bilan-actions"><button class="btn-primary" id="ct-refaire">🔁 Un autre contrôle sur ce cours</button></div>`;
          body.appendChild(fin);
          fin.querySelectorAll("[data-revoir]").forEach(b => b.addEventListener("click", () => openNotionModal(b.dataset.revoir)));
          fin.querySelector("#ct-refaire").addEventListener("click", () => lancerControle(coursId));
          fin.scrollIntoView({ behavior: "smooth", block: "center" });
          loadNotions();
        },
      }));
    });
  } catch (err) {
    console.error(err);
    corps.querySelector(".game-body").innerHTML = `<div class="panel-info">❌ Impossible de préparer le contrôle. Réessaie dans un instant.</div>`;
  }
}

// ------------------------------------------------------------
// DICTÉE — la dernière liste importée = dictée de la semaine, les précédentes en archives
// ------------------------------------------------------------
let dicteeChoisie = null;
let dicteeEtat = null;
let dicteeMinuteur = null;

const ARTICLE_DEBUT = /^(l['’]|le |la |les |un |une |des |du |de |d['’])/i;
function sansArticle(m) { return String(m).replace(ARTICLE_DEBUT, "").trim(); }
function bonneEcriture(attendu, saisie) {
  const s = normaliser(saisie);
  return s === normaliser(attendu) || s === normaliser(sansArticle(attendu));
}
function estArticle(m, s, i) {
  return i === 0 && m.syllabes.length > 1 && (/['’]$/.test(s) || m.mot.startsWith(s + " "));
}

function htmlSyllabes(m) {
  if (!m.syllabes) return `<span class="syl syl-0">${esc(m.mot)}</span>`;
  let k = 0;
  return m.syllabes.map((s, i) => estArticle(m, s, i)
    ? `<span class="syl syl-art">${esc(s)}</span>${/['’]$/.test(s) ? "" : " "}`
    : `<span class="syl syl-${k++ % 2}">${esc(s)}</span>`).join("");
}

function htmlPieges(m) {
  if (!m.pieges) return esc(m.mot);
  return esc(m.pieges).replace(/\[([^\]]+)\]/g, `<b class="piege">$1</b>`);
}

function dateCourte(iso) {
  return iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : "";
}

async function loadDictee() {
  const el = document.getElementById("dictee-contenu");
  const eleve = eleveCourant;
  const encore = () => eleve === eleveCourant && matiereCourante === "dictee";
  let coursSnap, progSnap, repSnap;
  try {
    [coursSnap, progSnap, repSnap] = await Promise.all([
      getDocs(query(collection(db, "coursAnglais"), where("eleve", "==", eleve))),
      getDocs(query(collection(db, "progressionAnglais"), where("eleve", "==", eleve))),
      getDocs(query(collection(db, "reponsesAnglais"), where("eleve", "==", eleve))),
    ]);
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="panel-info">❌ Impossible de charger la dictée. Recharge la page.</div>`;
    return;
  }
  if (!encore()) return;
  const dicteesEnAttente = coursSnap.docs.filter(d => d.data().matiere === "dictee" && d.data().statut === "attente").length;
  const dictees = coursSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.matiere === "dictee" && c.statut !== "attente")
    .sort((a, b) => (b.dateAjout || "").localeCompare(a.dateAjout || ""));
  notionsById = {};
  progSnap.forEach(d => { const x = d.data(); if (x.matiere === "dictee") notionsById[d.id] = { id: d.id, ...x }; });
  coursById = Object.fromEntries(dictees.map(c => [c.id, c]));
  if (!dictees.length) {
    el.innerHTML = dicteesEnAttente
      ? `<div class="panel-info">⏳ Ta dictée est en préparation — tu la retrouveras ici bientôt.</div>`
      : `<div class="panel-info">Pas encore de dictée — va dans <strong>+ Une dictée</strong> et prends ta liste de mots en photo 📸</div>`;
    return;
  }
  const cours = dictees.find(c => c.id === dicteeChoisie) || dictees[0];
  if (!cours.prepa) {
    el.innerHTML = `<div class="panel-info">✨ Je prépare tes mots (syllabes, pièges, jeux)… environ 30 secondes.</div>`;
    try {
      const preparerDictee = httpsCallable(functions, "preparerDictee", { timeout: 180000 });
      cours.prepa = (await preparerDictee({ eleve, coursId: cours.id })).data.prepa || {};
    } catch (err) {
      console.error(err);
      cours.prepa = {};
    }
    if (!encore()) return;
  }
  const motDe = (c, v, index) => {
    const p = c.prepa?.[v.mot] || {};
    const n = Object.values(notionsById).find(x => x.coursId === c.id && x.label === v.mot);
    return {
      index, mot: v.mot, sens: p.sens || v.traduction || "", syllabes: p.syllabes || null, pieges: p.pieges || null,
      erreurs: p.erreurs || [], phrase: p.phrase || "", prioritaire: !!v.prioritaire,
      notionId: n?.id || null, niveau: n?.niveau || 0, dernierResultat: n?.dernierResultat ?? null,
    };
  };
  const tous = (cours.vocabulaire || []).map((v, index) => motDe(cours, v, index));
  const nbFluo = tous.filter(m => m.prioritaire).length;
  const fluoSeul = nbFluo > 0 && cours.listeComplete !== true;
  const archive = cours.id !== dictees[0].id;
  // Mots ratés au moins une fois dans une dictée plus ancienne et pas encore sus : ils reviennent cette semaine.
  const dejaRates = new Set(repSnap.docs.map(d => d.data()).filter(r => r.matiere === "dictee" && r.correct === false && r.notionId).map(r => r.notionId));
  const vusIci = new Set(tous.map(m => normaliser(m.mot)));
  const repris = archive ? [] : dictees.filter(c => c.id !== cours.id && (c.dateAjout || "") < (cours.dateAjout || "")).flatMap(c =>
    (c.vocabulaire || []).map((v, index) => ({ ...motDe(c, v, index), reprise: true, origine: c.titre }))
      .filter(m => m.notionId && dejaRates.has(m.notionId) && m.niveau < 3 && !vusIci.has(normaliser(m.mot)) && vusIci.add(normaliser(m.mot))));
  const mots = [...(fluoSeul ? tous.filter(m => m.prioritaire) : tous), ...repris];
  dicteeEtat = { cours, tous, mots, repris };
  const sus = mots.filter(m => m.niveau >= 3).length;
  const archives = dictees.filter(c => c.id !== cours.id);

  el.innerHTML = `${dicteesEnAttente ? `<div class="panel-info">⏳ Une nouvelle dictée est en préparation. En attendant, tu travailles celle-ci.</div>` : ""}
    <div class="dic-hero${archive ? " dic-hero-archive" : ""}">
      <div class="dic-kicker">${archive ? "📦 Ancienne dictée" : "📝 Dictée de la semaine"}</div>
      <h2>${esc(cours.titre)}</h2>
      <div class="dic-sub">${esc(dateCourte(cours.dateAjout))} · ${mots.length - repris.length} mot${mots.length - repris.length > 1 ? "s" : ""} à apprendre${fluoSeul ? " (les mots surlignés)" : ""}${repris.length ? ` + ${repris.length} repris des dictées précédentes` : ""}</div>
      <div class="dic-jauge"><span style="width:${mots.length ? Math.round(sus / mots.length * 100) : 0}%"></span></div>
      <div class="dic-jauge-txt">${sus} / ${mots.length} mots bien sus</div>
      ${nbFluo ? `<div class="dic-toggle">
        <button data-liste="fluo" class="${fluoSeul ? "on" : ""}">⭐ Mots surlignés (${nbFluo})</button>
        <button data-liste="tout" class="${fluoSeul ? "" : "on"}">📋 Toute la liste (${tous.length})</button></div>`
        : `<div class="dic-astuce">Aucun mot surligné repéré : touche ⭐ à côté d'un mot pour le marquer.</div>`}
      ${archive ? `<button class="dic-retour" id="dic-retour">← Revenir à la dictée de la semaine</button>` : ""}
    </div>
    <div class="dic-jeux">
      <button class="dic-jeu dj-apprendre" data-jeu="apprendre"><span class="tc-emoji">📖</span><span class="tc-title">Apprendre mes mots</span><span class="tc-sub">Syllabes, pièges, puis j'écris</span></button>
      <button class="dic-jeu dj-ecoute" data-jeu="ecoute"><span class="tc-emoji">🎧</span><span class="tc-title">J'écoute, j'écris</span><span class="tc-sub">Le mot est lu, je l'écris</span></button>
      <button class="dic-jeu dj-bonmot" data-jeu="bonmot"><span class="tc-emoji">🔍</span><span class="tc-title">Le bon mot</span><span class="tc-sub">Trouve la bonne écriture</span></button>
      <button class="dic-jeu dj-lettres" data-jeu="lettres"><span class="tc-emoji">🧩</span><span class="tc-title">Mot en morceaux</span><span class="tc-sub">Remets les morceaux dans l'ordre</span></button>
      <button class="dic-jeu dj-flash" data-jeu="flash"><span class="tc-emoji">⚡</span><span class="tc-title">Mot flash</span><span class="tc-sub">Je regarde, il disparaît, je l'écris</span></button>
      <button class="dic-jeu dj-phrases" data-jeu="phrases"><span class="tc-emoji">✍️</span><span class="tc-title">Petites phrases</span><span class="tc-sub">Comme le jour de la dictée</span></button>
    </div>
    <h3 class="section-title">📋 Mes mots <span>${tous.length}</span></h3>
    <div class="dic-mots">${tous.map(m => {
      const hors = fluoSeul && !m.prioritaire;
      const st = statutNiveau(m.niveau);
      return `<div class="dic-mot${hors ? " hors" : ""}">
        <button class="dic-mot-main" data-voir="${m.index}"><span class="dic-mot-syl">${htmlSyllabes(m)}</span>${m.sens ? `<span class="dic-mot-sens">${esc(m.sens)}</span>` : ""}</button>
        ${hors ? "" : `<span class="pill ${st.cls}">${m.niveau >= 3 ? "Su" : m.dernierResultat === null ? "Nouveau" : "En cours"}</span>`}
        <button class="dic-icone" data-dire="${m.index}" title="Écouter">🔊</button>
        <button class="dic-icone dic-star${m.prioritaire ? " on" : ""}" data-star="${m.index}" title="${m.prioritaire ? "Retirer des mots surlignés" : "Marquer comme surligné"}">⭐</button>
      </div>`;
    }).join("")}</div>
    ${repris.length ? `<h3 class="section-title">🔁 Repris des dictées précédentes <span>${repris.length}</span></h3>
      <p class="muted dic-repris-info">Des mots qui t'ont piégée avant : ils restent ici jusqu'à ce que tu les saches.</p>
      <div class="dic-mots">${repris.map((m, k) => `<div class="dic-mot dic-mot-repris">
        <button class="dic-mot-main" data-voir-repris="${k}"><span class="dic-mot-syl">${htmlSyllabes(m)}</span><span class="dic-mot-sens">${esc(m.origine)}</span></button>
        <span class="pill ${statutNiveau(m.niveau).cls}">À revoir</span>
        <button class="dic-icone" data-dire-repris="${k}" title="Écouter">🔊</button>
      </div>`).join("")}</div>` : ""}
    <div id="dic-erreur" class="dic-astuce" hidden></div>
    ${archives.length ? `<h3 class="section-title">📦 Dictées précédentes <span>${archives.length}</span></h3>
      ${archives.map(c => `<details class="dic-archive"><summary><b>${esc(c.titre)}</b> <span class="muted">· ${esc(dateCourte(c.dateAjout))} · ${(c.vocabulaire || []).length} mots</span></summary>
        <div class="dic-archive-mots">${(c.vocabulaire || []).map(v => `<span class="${v.prioritaire ? "fluo" : ""}">${esc(v.mot)}</span>`).join("")}</div>
        <button class="btn-ghost-small" data-retravailler="${esc(c.id)}">🔁 Retravailler cette dictée</button></details>`).join("")}` : ""}`;

  el.querySelectorAll("[data-jeu]").forEach(b => b.addEventListener("click", () => lancerJeuDictee(b.dataset.jeu)));
  el.querySelectorAll("[data-voir]").forEach(b => b.addEventListener("click", () => {
    const m = tous[Number(b.dataset.voir)];
    const liste = ordreApprentissage();
    const i = liste.indexOf(m);
    apprendreMots(i >= 0 ? liste : [m], Math.max(i, 0));
  }));
  el.querySelectorAll("[data-voir-repris]").forEach(b => b.addEventListener("click", () => apprendreMots(ordreApprentissage(), Math.max(0, ordreApprentissage().indexOf(repris[Number(b.dataset.voirRepris)])))));
  el.querySelectorAll("[data-dire-repris]").forEach(b => b.addEventListener("click", () => dire(repris[Number(b.dataset.direRepris)].mot, 0.8, "fr")));
  el.querySelectorAll("[data-dire]").forEach(b => b.addEventListener("click", () => dire(tous[Number(b.dataset.dire)].mot, 0.8, "fr")));
  el.querySelectorAll("[data-star]").forEach(b => b.addEventListener("click", () => basculerFluo(tous[Number(b.dataset.star)], b)));
  el.querySelectorAll("[data-liste]").forEach(b => b.addEventListener("click", () => choisirListe(b.dataset.liste === "tout")));
  el.querySelectorAll("[data-retravailler]").forEach(b => b.addEventListener("click", () => { dicteeChoisie = b.dataset.retravailler; loadDictee(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
  el.querySelector("#dic-retour")?.addEventListener("click", () => { dicteeChoisie = null; loadDictee(); });
}

function erreurDictee(err) {
  console.error(err);
  const el = document.getElementById("dic-erreur");
  if (el) { el.hidden = false; el.textContent = `❌ Modification non enregistrée (${err.code || err.message}). Réessaie.`; }
}

async function basculerFluo(m, btn) {
  const { cours } = dicteeEtat;
  btn.disabled = true;
  const vocabulaire = (cours.vocabulaire || []).map((v, i) => {
    if (i !== m.index) return v;
    const copie = { ...v };
    if (m.prioritaire) delete copie.prioritaire; else copie.prioritaire = true;
    return copie;
  });
  try {
    await updateDoc(doc(db, "coursAnglais", cours.id), { vocabulaire });
    if (m.notionId) await updateDoc(doc(db, "progressionAnglais", m.notionId), { prioritaire: !m.prioritaire });
    loadDictee();
  } catch (err) {
    btn.disabled = false;
    erreurDictee(err);
  }
}

async function choisirListe(complete) {
  try {
    await updateDoc(doc(db, "coursAnglais", dicteeEtat.cours.id), { listeComplete: complete });
    loadDictee();
  } catch (err) {
    erreurDictee(err);
  }
}

// Mots les moins sus d'abord (ratés la dernière fois en tête), mélangés à niveau égal.
function serieDictee(filtre = () => true, n = 10) {
  const rang = m => (m.dernierResultat === false ? -1 : m.niveau);
  return melanger(dicteeEtat.mots.filter(filtre)).sort((a, b) => rang(a) - rang(b)).slice(0, n);
}

function noterMot(m, correct, { pas = 1, source, question = "", reponse = "" }) {
  if (m.notionId) enregistrerReponse(m.notionId, correct, { pas, source, question: question || m.mot, reponse });
}

// Ordre des cartes : ratés la dernière fois, puis les moins sus ; les mots déjà sus seulement s'il ne reste qu'eux.
function ordreApprentissage() {
  const rang = m => (m.dernierResultat === false ? -1 : m.niveau);
  const aSavoir = dicteeEtat.mots.filter(m => m.niveau < 3);
  return [...(aSavoir.length ? aSavoir : dicteeEtat.mots)].sort((a, b) => rang(a) - rang(b));
}

function lancerJeuDictee(jeu) {
  if (!dicteeEtat?.mots.length) return;
  if (jeu === "apprendre") return apprendreMots(ordreApprentissage(), 0);
  if (jeu === "ecoute") return jeuEcrire("ecoute");
  if (jeu === "flash") return jeuEcrire("flash");
  if (jeu === "bonmot") return jeuBonMot();
  if (jeu === "lettres") return jeuMorceaux();
  if (jeu === "phrases") return jeuPhrases();
}

function finJeuDictee(corps, titre, bonnes, total, relancer, rates = []) {
  corps.querySelector(".game-body").innerHTML = `<div class="today-score${total && bonnes / total < 0.7 ? " score-low" : ""}">${titre} : ${bonnes}/${total}</div>
    ${rates.length ? `<div class="exemples-title">Mots à revoir</div>
      <div class="dic-a-revoir">${rates.map(m => `<span>${htmlPieges(m)}</span>`).join("")}</div>
      <button class="btn-primary btn-block" id="dj-revoir-cartes">📖 Les revoir en cartes</button>` : ""}
    <button class="btn-${rates.length ? "ghost-small dj-autre" : "primary btn-block"}" id="dj-encore">🔁 Encore une série</button>
    <button class="btn-ghost-small dj-autre" id="dj-autre">🎮 Choisir un autre jeu</button>`;
  corps.querySelector("#dj-encore").addEventListener("click", relancer);
  corps.querySelector("#dj-revoir-cartes")?.addEventListener("click", () => apprendreMots(rates, 0));
  corps.querySelector("#dj-autre").addEventListener("click", () => document.getElementById("modal-libre-close").click());
}

// APPRENDRE : syllabes en couleurs → pièges en rouge → mot normal → carte blanche → je l'écris (facultatif).
const ETAPES_APPRENDRE = [
  "Lis les syllabes une par une. Touche la carte pour continuer.",
  "Les pièges sont en rouge : regarde-les bien.",
  "Voici le mot. Prends-le en photo dans ta tête 📸",
  "Carte blanche : arrives-tu à voir le mot dans ta tête ?",
  "À toi ! Écris le mot… ou passe au suivant si tu es fatiguée.",
];

function apprendreMots(liste, depart = 0) {
  let i = depart, etape = 0;
  const corps = ouvrirLibre(`<div class="game-head hdr-apprendre"><div class="modal-kicker">📖 Apprendre mes mots</div><h3 id="ap-compteur"></h3></div><div class="game-body"></div>`);
  const afficher = () => {
    if (i >= liste.length) {
      corps.querySelector(".game-body").innerHTML = `<div class="today-score">🎉 Tu as vu tes ${liste.length} mot${liste.length > 1 ? "s" : ""} !</div>
        <button class="btn-primary btn-block" id="ap-encore">🔁 Recommencer</button>
        <button class="btn-ghost-small dj-autre" id="dj-autre">🎮 Choisir un autre jeu</button>`;
      corps.querySelector("#ap-encore").addEventListener("click", () => { i = 0; etape = 0; afficher(); });
      corps.querySelector("#dj-autre").addEventListener("click", () => document.getElementById("modal-libre-close").click());
      return;
    }
    const m = liste[i];
    corps.querySelector("#ap-compteur").textContent = `Mot ${i + 1} / ${liste.length}`;
    const contenu = [
      `<div class="ap-mot">${htmlSyllabes(m)}</div>`,
      `<div class="ap-mot">${htmlPieges(m)}</div>`,
      `<div class="ap-mot ap-normal">${esc(m.mot)}</div>`,
      `<div class="ap-mot ap-blanc">&nbsp;</div>`,
      `<div class="ap-ecrire"><input type="text" class="exo-input" id="ap-saisie" placeholder="Écris le mot…" autocapitalize="off" autocomplete="off" spellcheck="false"><button class="btn-primary btn-small" id="ap-valider">Valider</button></div><div id="ap-resultat"></div>`,
    ][etape];
    corps.querySelector(".game-body").innerHTML = `
      <div class="ap-points">${ETAPES_APPRENDRE.map((_, k) => `<span class="${k <= etape ? "on" : ""}"></span>`).join("")}</div>
      <${etape < 4 ? "button" : "div"} class="ap-carte ap-etape-${etape}" id="ap-carte">${contenu}</${etape < 4 ? "button" : "div"}>
      <div class="ap-legende">${ETAPES_APPRENDRE[etape]}</div>
      ${etape < 3 && m.sens ? `<div class="ap-sens">💡 ${esc(m.sens)}</div>` : ""}
      <div class="ap-nav">
        <button class="btn-ghost-small" id="ap-prec" ${i === 0 && etape === 0 ? "disabled" : ""}>← Retour</button>
        <button class="pr-micro di-play ap-son" id="ap-son" title="Écouter">🔊</button>
        <button class="btn-ghost-small" id="ap-suivant">Mot suivant →</button>
      </div>`;
    if (etape === 0) dire(m.mot, 0.8, "fr");
    corps.querySelector("#ap-son").addEventListener("click", () => dire(m.mot, 0.8, "fr"));
    corps.querySelector("#ap-suivant").addEventListener("click", () => { i += 1; etape = 0; afficher(); });
    corps.querySelector("#ap-prec").addEventListener("click", () => {
      if (etape > 0) etape -= 1; else if (i > 0) { i -= 1; etape = 0; }
      afficher();
    });
    if (etape < 4) {
      corps.querySelector("#ap-carte").addEventListener("click", () => { etape += 1; afficher(); });
      return;
    }
    const input = corps.querySelector("#ap-saisie");
    input.focus();
    const valider = () => {
      if (!input.value.trim() || input.disabled) return;
      const ok = bonneEcriture(m.mot, input.value);
      input.disabled = true;
      corps.querySelector("#ap-valider").disabled = true;
      input.classList.add(ok ? "correct" : "incorrect");
      noterMot(m, ok, { source: "dictee-apprendre", reponse: input.value.trim() });
      corps.querySelector("#ap-resultat").innerHTML = `<div class="pr-verdict ${ok ? "ok" : "ko"}">${ok ? "✅ Bravo, c'est juste !" : "💡 Presque ! Regarde bien les pièges :"}</div>
        <div class="ap-mot ap-petit">${htmlPieges(m)}</div>`;
    };
    corps.querySelector("#ap-valider").addEventListener("click", valider);
    input.addEventListener("keydown", e => { if (e.key === "Enter") valider(); });
  };
  afficher();
}

// J'ÉCOUTE J'ÉCRIS / MOT FLASH : même saisie, seule la présentation du mot change.
function jeuEcrire(mode) {
  const serie = serieDictee();
  const flash = mode === "flash";
  const titre = flash ? "⚡ Mot flash" : "🎧 J'écoute, j'écris";
  const corps = ouvrirLibre(`<div class="game-head ${flash ? "hdr-flash" : "hdr-dictee"}"><div class="modal-kicker">${titre}</div><h3 id="dj-compteur"></h3></div><div class="game-body"></div>`);
  let i = 0, bonnes = 0, revu = false;
  const nbMots = serie.length, rates = [];
  const raterMot = m => { if (!rates.includes(m)) { rates.push(m); serie.push(m); } };
  const premierEssai = m => !rates.includes(m);
  const afficher = () => {
    clearTimeout(dicteeMinuteur);
    if (i >= serie.length) return finJeuDictee(corps, titre, bonnes, nbMots, () => jeuEcrire(mode), rates);
    const m = serie[i];
    revu = false;
    corps.querySelector("#dj-compteur").textContent = premierEssai(m) || i < nbMots ? `${Math.min(i + 1, nbMots)} / ${nbMots}` : "🔁 Deuxième essai";
    corps.querySelector(".game-body").innerHTML = `
      ${flash ? `<div class="flash-zone" id="flash-zone"><div class="ap-mot">${htmlSyllabes(m)}</div><div class="flash-barre"><span></span></div></div>`
        : `<div class="pr-actions"><button class="pr-micro di-play" id="dj-play">🔊</button><button class="btn-ghost-small" id="dj-lent">🐢 Plus lentement</button></div>`}
      <div class="ap-ecrire" id="dj-ecrire" ${flash ? "hidden" : ""}><input type="text" class="exo-input" id="dj-saisie" placeholder="Écris le mot…" autocapitalize="off" autocomplete="off" spellcheck="false"><button class="btn-primary btn-small" id="dj-valider">Valider</button></div>
      ${flash ? `<button class="btn-ghost-small" id="dj-revoir" hidden>👀 Revoir le mot (une fois)</button>` : ""}
      <div id="dj-resultat"></div>`;
    const input = corps.querySelector("#dj-saisie");
    const cacher = () => {
      const zone = corps.querySelector("#flash-zone");
      if (!zone) return;
      zone.classList.add("cache");
      corps.querySelector("#dj-ecrire").hidden = false;
      const rv = corps.querySelector("#dj-revoir");
      if (rv) rv.hidden = revu;
      input.focus();
    };
    if (flash) {
      dicteeMinuteur = setTimeout(cacher, 3000);
      corps.querySelector("#dj-revoir").addEventListener("click", (e) => {
        revu = true;
        e.currentTarget.hidden = true;
        const zone = corps.querySelector("#flash-zone");
        zone.classList.remove("cache");
        zone.querySelector(".flash-barre").innerHTML = "<span></span>";
        dicteeMinuteur = setTimeout(cacher, 3000);
      });
    } else {
      corps.querySelector("#dj-play").addEventListener("click", () => dire(m.mot, 0.85, "fr"));
      corps.querySelector("#dj-lent").addEventListener("click", () => dire(m.mot, 0.6, "fr"));
      setTimeout(() => dire(m.mot, 0.85, "fr"), 300);
      input.focus();
    }
    const valider = () => {
      if (!input.value.trim() || input.disabled) return;
      clearTimeout(dicteeMinuteur);
      const ok = bonneEcriture(m.mot, input.value);
      if (ok && premierEssai(m)) bonnes += 1;
      if (!ok && i < nbMots) raterMot(m);
      input.disabled = true;
      corps.querySelector("#dj-valider").disabled = true;
      corps.querySelector("#dj-revoir")?.remove();
      input.classList.add(ok ? "correct" : "incorrect");
      noterMot(m, ok, { source: `dictee-${mode}`, reponse: input.value.trim() });
      corps.querySelector("#dj-resultat").innerHTML = `<div class="pr-verdict ${ok ? "ok" : "ko"}">${ok ? "✅ Bravo !" : "💡 Le mot s'écrit :"}</div>
        <div class="ap-mot ap-petit">${htmlPieges(m)}</div>
        <button class="btn-primary btn-block" id="dj-suivant">Mot suivant →</button>`;
      corps.querySelector("#dj-suivant").addEventListener("click", () => { i += 1; afficher(); });
    };
    corps.querySelector("#dj-valider").addEventListener("click", valider);
    input.addEventListener("keydown", e => { if (e.key === "Enter") valider(); });
  };
  afficher();
}

// LE BON MOT : 3 écritures, une seule juste.
function jeuBonMot() {
  const serie = serieDictee(m => m.erreurs.length > 0);
  const titre = "🔍 Le bon mot";
  const corps = ouvrirLibre(`<div class="game-head hdr-bonmot"><div class="modal-kicker">${titre}</div><h3 id="dj-compteur"></h3></div><div class="game-body"></div>`);
  if (!serie.length) { corps.querySelector(".game-body").innerHTML = `<div class="panel-info">Ce jeu n'est pas encore prêt pour cette dictée.</div>`; return; }
  let i = 0, bonnes = 0;
  const nbMots = serie.length, rates = [];
  const raterMot = m => { if (!rates.includes(m)) { rates.push(m); serie.push(m); } };
  const premierEssai = m => !rates.includes(m);
  const afficher = () => {
    if (i >= serie.length) return finJeuDictee(corps, titre, bonnes, nbMots, jeuBonMot, rates);
    const m = serie[i];
    const choix = melanger([m.mot, ...m.erreurs]);
    corps.querySelector("#dj-compteur").textContent = premierEssai(m) || i < nbMots ? `${Math.min(i + 1, nbMots)} / ${nbMots}` : "🔁 Deuxième essai";
    corps.querySelector(".game-body").innerHTML = `
      <div class="pr-actions"><button class="pr-micro di-play" id="dj-play">🔊</button></div>
      <p class="ap-legende">Quel mot est bien écrit ?</p>
      <div class="bonmot-choix">${choix.map((c, k) => `<button class="choix-btn bonmot-btn" data-k="${k}">${esc(c)}</button>`).join("")}</div>
      <div id="dj-resultat"></div>`;
    corps.querySelector("#dj-play").addEventListener("click", () => dire(m.mot, 0.85, "fr"));
    setTimeout(() => dire(m.mot, 0.85, "fr"), 300);
    corps.querySelectorAll("[data-k]").forEach(b => b.addEventListener("click", () => {
      const ok = choix[Number(b.dataset.k)] === m.mot;
      if (ok && premierEssai(m)) bonnes += 1;
      if (!ok && i < nbMots) raterMot(m);
      corps.querySelectorAll("[data-k]").forEach(x => {
        x.disabled = true;
        if (choix[Number(x.dataset.k)] === m.mot) x.classList.add("correct");
        else if (x === b) x.classList.add("incorrect");
      });
      noterMot(m, ok, { pas: 0, source: "dictee-bonmot", reponse: b.textContent });
      corps.querySelector("#dj-resultat").innerHTML = `<div class="pr-verdict ${ok ? "ok" : "ko"}">${ok ? "✅ Bien vu !" : "💡 Regarde bien les pièges :"}</div>
        <div class="ap-mot ap-petit">${htmlPieges(m)}</div>
        <button class="btn-primary btn-block" id="dj-suivant">Mot suivant →</button>`;
      corps.querySelector("#dj-suivant").addEventListener("click", () => { i += 1; afficher(); });
    }));
  };
  afficher();
}

// MOT EN MORCEAUX : syllabes mélangées (ou lettres pour un mot d'une syllabe).
function morceauxDe(m) {
  const syl = m.syllabes || [];
  const debut = syl.length > 1 && estArticle(m, syl[0], 0) ? syl[0] : "";
  const corpsSyl = debut ? syl.slice(1) : syl;
  const base = sansArticle(m.mot);
  const morceaux = corpsSyl.length >= 2 ? corpsSyl : [...base];
  return { debut, morceaux, cible: corpsSyl.length >= 2 ? corpsSyl.join("") : base };
}

function jeuMorceaux() {
  const serie = serieDictee();
  const titre = "🧩 Mot en morceaux";
  const corps = ouvrirLibre(`<div class="game-head hdr-lettres"><div class="modal-kicker">${titre}</div><h3 id="dj-compteur"></h3></div><div class="game-body"></div>`);
  let i = 0, bonnes = 0;
  const nbMots = serie.length, rates = [];
  const raterMot = m => { if (!rates.includes(m)) { rates.push(m); serie.push(m); } };
  const premierEssai = m => !rates.includes(m);
  const afficher = () => {
    if (i >= serie.length) return finJeuDictee(corps, titre, bonnes, nbMots, jeuMorceaux, rates);
    const m = serie[i];
    const { debut, morceaux, cible } = morceauxDe(m);
    let tirage = melanger(morceaux);
    for (let essai = 0; essai < 5 && tirage.join("") === morceaux.join("") && morceaux.length > 1; essai++) tirage = melanger(morceaux);
    const choisis = [];
    corps.querySelector("#dj-compteur").textContent = premierEssai(m) || i < nbMots ? `${Math.min(i + 1, nbMots)} / ${nbMots}` : "🔁 Deuxième essai";
    corps.querySelector(".game-body").innerHTML = `
      <div class="pr-actions"><button class="pr-micro di-play" id="dj-play">🔊</button></div>
      <div class="ordre-cible morceaux-cible" id="mc-cible"></div>
      <div class="ordre-reserve morceaux-reserve">${tirage.map((t, k) => `<button class="mot-chip morceau" data-k="${k}">${esc(t)}</button>`).join("")}</div>
      <div class="exo-input-row"><button class="btn-ghost-small" id="mc-effacer">↺ Recommencer</button><button class="btn-primary btn-small" id="mc-valider">Valider</button></div>
      <div id="dj-resultat"></div>`;
    const cibleEl = corps.querySelector("#mc-cible");
    const majCible = () => { cibleEl.innerHTML = `${debut ? `<span class="syl syl-art">${esc(debut)}</span> ` : ""}${choisis.length ? choisis.map(c => `<b>${esc(c.t)}</b>`).join("") : `<span class="muted">Touche les morceaux dans l'ordre…</span>`}`; };
    majCible();
    corps.querySelector("#dj-play").addEventListener("click", () => dire(m.mot, 0.8, "fr"));
    setTimeout(() => dire(m.mot, 0.8, "fr"), 300);
    let fini = false;
    corps.querySelectorAll("[data-k]").forEach(b => b.addEventListener("click", () => {
      if (fini || b.disabled) return;
      b.disabled = true;
      choisis.push({ t: tirage[Number(b.dataset.k)], b });
      majCible();
    }));
    corps.querySelector("#mc-effacer").addEventListener("click", () => {
      if (fini) return;
      choisis.splice(0).forEach(c => { c.b.disabled = false; });
      majCible();
    });
    corps.querySelector("#mc-valider").addEventListener("click", () => {
      if (fini || choisis.length < morceaux.length) return;
      fini = true;
      const ok = choisis.map(c => c.t).join("") === cible;
      if (ok && premierEssai(m)) bonnes += 1;
      if (!ok && i < nbMots) raterMot(m);
      cibleEl.classList.add(ok ? "correct" : "incorrect");
      noterMot(m, ok, { pas: 0, source: "dictee-morceaux", reponse: choisis.map(c => c.t).join("") });
      corps.querySelector("#dj-resultat").innerHTML = `<div class="pr-verdict ${ok ? "ok" : "ko"}">${ok ? "✅ Bravo !" : "💡 Dans l'ordre, ça donne :"}</div>
        <div class="ap-mot ap-petit">${htmlSyllabes(m)}</div>
        <button class="btn-primary btn-block" id="dj-suivant">Mot suivant →</button>`;
      corps.querySelector("#dj-suivant").addEventListener("click", () => { i += 1; afficher(); });
    });
  };
  afficher();
}

// PETITES PHRASES : une phrase courte par mot, comme le jour de la dictée.
function jeuPhrases() {
  const serie = serieDictee(m => m.phrase, 5);
  const titre = "✍️ Petites phrases";
  const corps = ouvrirLibre(`<div class="game-head hdr-phrases"><div class="modal-kicker">${titre}</div><h3 id="dj-compteur"></h3></div><div class="game-body"></div>`);
  if (!serie.length) { corps.querySelector(".game-body").innerHTML = `<div class="panel-info">Ce jeu n'est pas encore prêt pour cette dictée.</div>`; return; }
  let i = 0, bonnes = 0;
  const nbMots = serie.length, rates = [];
  const raterMot = m => { if (!rates.includes(m)) { rates.push(m); serie.push(m); } };
  const premierEssai = m => !rates.includes(m);
  const afficher = () => {
    if (i >= serie.length) return finJeuDictee(corps, titre, bonnes, nbMots, jeuPhrases, rates);
    const m = serie[i];
    corps.querySelector("#dj-compteur").textContent = premierEssai(m) || i < nbMots ? `${Math.min(i + 1, nbMots)} / ${nbMots}` : "🔁 Deuxième essai";
    corps.querySelector(".game-body").innerHTML = `
      <div class="pr-actions"><button class="pr-micro di-play" id="dj-play">🔊</button><button class="btn-ghost-small" id="dj-lent">🐢 Plus lentement</button></div>
      <textarea id="dj-saisie" class="di-saisie" rows="2" placeholder="Écris la phrase…" autocapitalize="off" spellcheck="false"></textarea>
      <button class="btn-primary btn-block" id="dj-valider">Valider</button>
      <div id="dj-resultat"></div>`;
    corps.querySelector("#dj-play").addEventListener("click", () => dire(m.phrase, 0.8, "fr"));
    corps.querySelector("#dj-lent").addEventListener("click", () => dire(m.phrase, 0.55, "fr"));
    setTimeout(() => dire(m.phrase, 0.8, "fr"), 300);
    corps.querySelector("#dj-valider").addEventListener("click", (e) => {
      const saisie = corps.querySelector("#dj-saisie").value.trim();
      if (!saisie) return;
      const { resultat, taux } = comparerMots(m.phrase, saisie);
      const ecrits = motsDe(saisie);
      const motOk = ` ${normaliser(saisie)} `.includes(normaliser(sansArticle(m.mot)));
      const ok = taux === 1 && ecrits.length === motsDe(m.phrase).length;
      if (ok && premierEssai(m)) bonnes += 1;
      if (!ok && i < nbMots) raterMot(m);
      noterMot(m, motOk, { source: "dictee-phrase", question: m.phrase, reponse: saisie });
      e.currentTarget.remove();
      corps.querySelector("#dj-saisie").disabled = true;
      corps.querySelector("#dj-resultat").innerHTML = `
        <div class="pr-verdict ${ok ? "ok" : "ko"}">${ok ? "✅ Phrase parfaite !" : motOk ? "👍 Le mot de la liste est juste !" : "💡 Regarde les mots en rouge :"}</div>
        <div class="di-correction">${resultat.map(x => `<span class="${x.ok ? "pm-ok" : "pm-ko"}">${esc(x.m)}</span>`).join(" ")}</div>
        <button class="btn-primary btn-block" id="dj-suivant">Phrase suivante →</button>`;
      corps.querySelector("#dj-suivant").addEventListener("click", () => { i += 1; afficher(); });
    });
  };
  afficher();
}

// ------------------------------------------------------------
// TABLES DE MULTIPLICATION (maths) — un document par élève : tables de la semaine + suivi de chaque calcul
// ------------------------------------------------------------
let tablesEtat = null;
let tablesMinuteur = null;
const TABLES_DEFAUT = { ce2: [5, 6], college: [2, 3, 4, 5, 6, 7, 8, 9] };

function cleFait(f) { return `${f.t}x${f.n}`; }
function infoFait(f) { return tablesEtat?.faits?.[cleFait(f)] || null; }
function delaiRapide() { return eleveInfo()?.niveau === "ce2" ? 8000 : 5000; }
function faitsDeTable(t) { return Array.from({ length: 10 }, (_, k) => ({ t, n: k + 1 })); }
function faitsActifs() { return tablesEtat.actives.flatMap(faitsDeTable); }
function estSu(f) { return (infoFait(f)?.niveau || 0) >= 3; }
function enonce(f) { return f.inverse ? `${f.n} × ${f.t}` : `${f.t} × ${f.n}`; }
function listeTables(ts) { return ts.length > 1 ? `${ts.slice(0, -1).join(", ")} et ${ts[ts.length - 1]}` : String(ts[0] ?? ""); }

function astuceFait(f) {
  const { t, n } = f, r = t * n;
  if (n === 1) return `N'importe quel nombre × 1 reste le même : ${r}.`;
  if (n === 10) return `× 10 : on écrit un 0 à droite → ${r}.`;
  if (n === 2) return `× 2, c'est le double : ${t} + ${t} = ${r}.`;
  if (t === 9 && n <= 10) return `Table de 9 : ${n} × 9 = ${n} × 10 − ${n} = ${n * 10} − ${n} = ${r}.`;
  if (t === 5) return `Table de 5 : le résultat finit toujours par 0 ou par 5. ${n} × 5 = moitié de ${n} × 10 = ${r}.`;
  if (n === 5) return `× 5 = la moitié de × 10 : ${t * 10} ÷ 2 = ${r}.`;
  if (n > 5) return `${t} × 5 = ${t * 5}, puis + ${t} × ${n - 5} = ${t * (n - 5)} → ${r}.`;
  return `${t} × ${n - 1} = ${t * (n - 1)}, + ${t} → ${r}.`;
}

// Ratés la dernière fois, puis jamais vus, puis à revoir aujourd'hui, puis les moins sus.
function serieTables(n = 12, pool = faitsActifs()) {
  const auj = todayISO();
  const rang = f => {
    const x = infoFait(f);
    if (!x) return 1;
    if (x.dernierResultat === false) return 0;
    if ((x.prochaineDate || "") <= auj) return 2 + x.niveau / 10;
    return 3 + x.niveau;
  };
  return melanger(pool).sort((a, b) => rang(a) - rang(b)).slice(0, n)
    .map(f => ({ ...f, inverse: eleveInfo()?.niveau === "ce2" ? Math.random() < 0.25 : Math.random() < 0.5 }));
}

async function enregistrerTables(champs) {
  try {
    await setDoc(doc(db, "tablesRevisions", eleveCourant), { eleve: eleveCourant, ...champs }, { merge: true });
    return true;
  } catch (err) {
    console.error("Tables", err);
    toast(`⚠️ Non enregistré (${err.code || err.message})`);
    return false;
  }
}

// rapideCompte = false : on ne monte pas de niveau (jeu de reconnaissance ou mode apprentissage).
function noterFait(f, correct, { ms = Infinity, donne = "", rapideCompte = true } = {}) {
  if (estParent()) return;
  const cle = cleFait(f);
  const x = { niveau: 0, vus: 0, rates: 0, ...(tablesEtat.faits[cle] || {}) };
  const monte = correct && rapideCompte && ms <= delaiRapide() && x.monteLe !== todayISO();
  x.niveau = correct ? Math.min(x.niveau + (monte ? 1 : 0), 5) : Math.max(x.niveau - 1, 0);
  if (monte) x.monteLe = todayISO();
  x.vus += 1;
  if (!correct) x.rates += 1;
  x.dernierResultat = correct;
  const d = new Date();
  d.setDate(d.getDate() + (correct ? NIVEAUX_JOURS[x.niveau] : 0));
  x.prochaineDate = d.toISOString().slice(0, 10);
  tablesEtat.faits[cle] = x;
  journaliser({ correct, source: "tables", question: enonce(f), reponse: donne });
  enregistrerTables({ faits: { [cle]: x } });
}

async function loadTables() {
  const el = document.getElementById("tables-contenu");
  const eleve = eleveCourant;
  let data = null;
  try {
    const snap = await getDoc(doc(db, "tablesRevisions", eleve));
    if (snap.exists()) data = snap.data();
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="panel-info">❌ Impossible de charger les tables. Recharge la page.</div>`;
    return;
  }
  if (eleve !== eleveCourant || matiereCourante !== "tables") return;
  tablesEtat = {
    actives: (data?.actives?.length ? data.actives : TABLES_DEFAUT[eleveInfo()?.niveau] || TABLES_DEFAUT.college).slice().sort((a, b) => a - b),
    faits: data?.faits || {},
    record: data?.record || 0,
    recordChute: data?.recordChute || 0,
  };
  const faits = faitsActifs();
  const sus = faits.filter(estSu).length;
  const cellule = f => {
    const x = infoFait(f);
    const cls = !x ? "tb-neuf" : x.niveau >= 3 ? "tb-su" : x.dernierResultat === false ? "tb-rate" : "tb-encours";
    return `<span class="tb-case ${cls}" title="${f.t} × ${f.n} = ${f.t * f.n}${x ? ` · vu ${x.vus} fois, raté ${x.rates} fois` : " · pas encore vu"}">${f.t}×${f.n}</span>`;
  };
  const autres = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter(t => !tablesEtat.actives.includes(t) && faitsDeTable(t).some(infoFait));
  el.innerHTML = `
    <div class="tb-hero">
      <div class="dic-kicker">✖️ Tables de multiplication</div>
      <h2>${tablesEtat.actives.length === 1 ? "Table" : "Tables"} de la semaine : ${listeTables(tablesEtat.actives)}</h2>
      <div class="dic-jauge"><span style="width:${faits.length ? Math.round(sus / faits.length * 100) : 0}%"></span></div>
      <div class="dic-jauge-txt">${sus} / ${faits.length} calculs bien sus${tablesEtat.record ? ` · 🏆 record du défi : ${tablesEtat.record}` : ""}</div>
      <div class="tb-choix-titre">Choisir les tables :</div>
      <div class="tb-choix">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(t => `<button data-table="${t}" class="${tablesEtat.actives.includes(t) ? "on" : ""}">${t}</button>`).join("")}</div>
    </div>
    <div class="dic-jeux">
      <button class="dic-jeu tj-apprendre" data-tjeu="apprendre"><span class="tc-emoji">📖</span><span class="tc-title">Apprendre une table</span><span class="tc-sub">Je la lis, puis je joue à cache-cache</span></button>
      <button class="dic-jeu tj-entrainement" data-tjeu="entrainement"><span class="tc-emoji">🎯</span><span class="tc-title">Entraînement</span><span class="tc-sub">Mes erreurs reviennent en premier</span></button>
      <button class="dic-jeu tj-qcm" data-tjeu="qcm"><span class="tc-emoji">🔍</span><span class="tc-title">Le bon résultat</span><span class="tc-sub">Trouve la bonne réponse</span></button>
      <button class="dic-jeu tj-defi" data-tjeu="defi"><span class="tc-emoji">⏱️</span><span class="tc-title">Défi 1 minute</span><span class="tc-sub">${tablesEtat.record ? `Bats ton record : ${tablesEtat.record}` : "Le plus de calculs possible"}</span></button>
      <button class="dic-jeu tj-chute" data-tjeu="chute"><span class="tc-emoji">🪂</span><span class="tc-title">Calcul qui tombe</span><span class="tc-sub">${tablesEtat.recordChute ? `Bats ton record : ${tablesEtat.recordChute}` : "Réponds avant qu'il touche la ligne !"}</span></button>
    </div>
    <h3 class="section-title">🗺️ Ma carte des tables</h3>
    <div class="tb-legende"><span class="tb-case tb-su">su</span><span class="tb-case tb-encours">en cours</span><span class="tb-case tb-rate">raté</span><span class="tb-case tb-neuf">pas vu</span></div>
    ${tablesEtat.actives.map(t => `<div class="tb-ligne"><div class="tb-ligne-titre">Table de ${t}</div><div class="tb-cases">${faitsDeTable(t).map(cellule).join("")}</div></div>`).join("")}
    ${autres.length ? `<details class="dic-archive"><summary><b>Autres tables déjà travaillées</b></summary>
      ${autres.map(t => `<div class="tb-ligne"><div class="tb-ligne-titre">Table de ${t}</div><div class="tb-cases">${faitsDeTable(t).map(cellule).join("")}</div></div>`).join("")}</details>` : ""}`;
  el.querySelectorAll("[data-table]").forEach(b => b.addEventListener("click", () => basculerTable(Number(b.dataset.table))));
  el.querySelectorAll("[data-tjeu]").forEach(b => b.addEventListener("click", () => {
    const jeu = b.dataset.tjeu;
    if (jeu === "apprendre") choisirTableAApprendre();
    if (jeu === "entrainement") jeuTablesEcrire();
    if (jeu === "qcm") jeuTablesQcm();
    if (jeu === "defi") jeuTablesDefi();
    if (jeu === "chute") jeuTablesChute();
  }));
}

async function basculerTable(t) {
  const actives = tablesEtat.actives.includes(t) ? tablesEtat.actives.filter(x => x !== t) : [...tablesEtat.actives, t];
  if (!actives.length) return toast("Garde au moins une table 🙂");
  if (await enregistrerTables({ actives: actives.sort((a, b) => a - b) })) loadTables();
}

function fermerJeuTables() {
  clearTimeout(tablesMinuteur);
  clearInterval(tablesMinuteur);
  document.getElementById("modal-libre-close").click();
}

function finJeuTables(corps, titre, bonnes, total, relancer, rates = []) {
  clearInterval(tablesMinuteur);
  corps.querySelector(".game-body").innerHTML = `<div class="today-score${total && bonnes / total < 0.7 ? " score-low" : ""}">${titre} : ${bonnes}/${total}</div>
    ${rates.length ? `<div class="exemples-title">À revoir</div><div class="dic-a-revoir">${rates.map(f => `<span>${f.t} × ${f.n} = ${f.t * f.n}</span>`).join("")}</div>` : ""}
    <button class="btn-primary btn-block" id="tj-encore">🔁 Encore une série</button>
    <button class="btn-ghost-small dj-autre" id="tj-autre">🎮 Choisir un autre jeu</button>`;
  corps.querySelector("#tj-encore").addEventListener("click", relancer);
  corps.querySelector("#tj-autre").addEventListener("click", fermerJeuTables);
}

// Champ de réponse numérique (clavier chiffres sur téléphone) + bouton OK.
function champNombre(corps, onValider) {
  const input = corps.querySelector("#tj-saisie");
  const valider = () => {
    const v = input.value.trim().replace(/\s/g, "");
    if (!v || input.disabled) return;
    onValider(v);
  };
  corps.querySelector("#tj-ok").addEventListener("click", valider);
  input.addEventListener("keydown", e => { if (e.key === "Enter") valider(); });
  input.focus();
  return input;
}

const HTML_SAISIE = `<div class="ap-ecrire tj-ecrire"><input type="text" inputmode="numeric" pattern="[0-9]*" class="exo-input" id="tj-saisie" placeholder="?" autocomplete="off"><button class="btn-primary btn-small" id="tj-ok">OK</button></div>`;

// APPRENDRE : choix de la table, lecture, puis cache-cache en 3 manches (3, 6 puis 10 résultats cachés).
function choisirTableAApprendre() {
  const corps = ouvrirLibre(`<div class="game-head hdr-tapprendre"><div class="modal-kicker">📖 Apprendre une table</div><h3>Quelle table ?</h3></div>
    <div class="game-body"><div class="tb-choix tb-choix-grand">${tablesEtat.actives.map(t => `<button data-t="${t}">${t}</button>`).join("")}</div></div>`);
  corps.querySelectorAll("[data-t]").forEach(b => b.addEventListener("click", () => apprendreTable(Number(b.dataset.t))));
}

function apprendreTable(t, manche = 0) {
  const faits = faitsDeTable(t);
  const nbCaches = [0, 3, 6, 10][manche];
  const caches = new Set(melanger(faits.map(f => f.n)).slice(0, nbCaches));
  const titres = ["Je lis la table", "Cache-cache : 3 résultats cachés", "Cache-cache : 6 résultats cachés", "Toute la table de tête !"];
  const corps = ouvrirLibre(`<div class="game-head hdr-tapprendre"><div class="modal-kicker">📖 Table de ${t}</div><h3>${titres[manche]}</h3></div>
    <div class="game-body">
      <div class="ap-points">${titres.map((_, k) => `<span class="${k <= manche ? "on" : ""}"></span>`).join("")}</div>
      <div class="tb-table">${faits.map(f => `<div class="tb-table-ligne"><span class="tb-calc">${t} × ${f.n} =</span>${caches.has(f.n)
        ? `<input type="text" inputmode="numeric" pattern="[0-9]*" class="tb-trou" data-n="${f.n}" autocomplete="off">`
        : `<span class="tb-res">${t * f.n}</span>`}</div>`).join("")}</div>
      ${manche === 0 ? `<p class="ap-legende">${astuceTable(t)}</p>
        <div class="pr-actions"><button class="pr-micro di-play" id="tb-lire" title="Écouter la table">🔊</button></div>` : ""}
      <div id="tb-resultat"></div>
      <button class="btn-primary btn-block" id="tb-action">${manche === 0 ? "Je la connais, on joue à cache-cache →" : "Vérifier"}</button>
    </div>`);
  corps.querySelector("#tb-lire")?.addEventListener("click", () => dire(faits.map(f => `${t} fois ${f.n}, ${t * f.n}`).join(". "), 0.8, "fr"));
  corps.querySelector(".tb-trou")?.focus();
  corps.querySelectorAll(".tb-trou").forEach((inp, k, tous) => inp.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); (tous[k + 1] || corps.querySelector("#tb-action")).focus(); }
  }));
  const bouton = corps.querySelector("#tb-action");
  let verifie = false, parfait = false;
  bouton.addEventListener("click", () => {
    if (manche === 0) return apprendreTable(t, 1);
    if (verifie) {
      if (!parfait) return apprendreTable(t, manche);
      return manche < 3 ? apprendreTable(t, manche + 1) : fermerJeuTables();
    }
    let bonnes = 0;
    corps.querySelectorAll(".tb-trou").forEach(inp => {
      const f = { t, n: Number(inp.dataset.n) };
      const ok = Number(inp.value.trim()) === t * f.n;
      if (ok) bonnes += 1;
      inp.disabled = true;
      inp.classList.add(ok ? "correct" : "incorrect");
      if (!ok) inp.insertAdjacentHTML("afterend", `<span class="tb-corr">${t * f.n}</span>`);
      noterFait(f, ok, { donne: inp.value.trim(), rapideCompte: false });
    });
    verifie = true;
    parfait = bonnes === caches.size;
    corps.querySelector("#tb-resultat").innerHTML = `<div class="pr-verdict ${parfait ? "ok" : "ko"}">${parfait ? "✅ Parfait !" : `${bonnes} / ${caches.size} — regarde les corrections en vert`}</div>`;
    bouton.textContent = parfait ? (manche < 3 ? "Manche suivante →" : "🎉 Terminé !") : "🔁 Recommencer cette manche";
  });
}

function astuceTable(t) {
  return {
    1: "× 1 : le nombre ne change pas.",
    2: "Table de 2 : ce sont les doubles, et les résultats sont tous pairs.",
    3: "Table de 3 : on avance de 3 en 3.",
    4: "Table de 4 : c'est le double de la table de 2.",
    5: "Table de 5 : les résultats finissent par 0 ou 5, comme les minutes sur une horloge.",
    6: "Table de 6 : c'est le double de la table de 3. Et 6 × un nombre pair finit par ce même nombre (6 × 4 = 24).",
    7: "Table de 7 : la plus dure ! Retiens 7 × 7 = 49 et 7 × 8 = 56 (5, 6, 7, 8).",
    8: "Table de 8 : c'est le double de la table de 4.",
    9: "Table de 9 : les dizaines montent, les unités descendent (09, 18, 27, 36…) et les deux chiffres font 9.",
    10: "Table de 10 : on ajoute un 0.",
  }[t] || "";
}

// ENTRAÎNEMENT : saisie, rapidité mesurée, raté = 2e essai en fin de série + astuce.
function jeuTablesEcrire() {
  const serie = serieTables(eleveInfo()?.niveau === "ce2" ? 10 : 15);
  const titre = "🎯 Entraînement";
  const corps = ouvrirLibre(`<div class="game-head hdr-tentrainement"><div class="modal-kicker">${titre}</div><h3 id="tj-compteur"></h3></div><div class="game-body"></div>`);
  const nbFaits = serie.length, rates = [];
  let i = 0, bonnes = 0;
  const afficher = () => {
    if (i >= serie.length) return finJeuTables(corps, titre, bonnes, nbFaits, jeuTablesEcrire, rates);
    const f = serie[i];
    const deuxieme = i >= nbFaits;
    corps.querySelector("#tj-compteur").textContent = deuxieme ? "🔁 Deuxième essai" : `${i + 1} / ${nbFaits}`;
    corps.querySelector(".game-body").innerHTML = `<div class="tj-question">${enonce(f)} = ?</div>${HTML_SAISIE}<div id="tj-resultat"></div>`;
    const debut = Date.now();
    const input = champNombre(corps, v => {
      const ms = Date.now() - debut;
      const ok = Number(v) === f.t * f.n;
      input.disabled = true;
      corps.querySelector("#tj-ok").disabled = true;
      input.classList.add(ok ? "correct" : "incorrect");
      noterFait(f, ok, { ms, donne: v });
      if (ok && !deuxieme) bonnes += 1;
      if (!ok && !deuxieme) { rates.push(f); serie.push({ ...f, inverse: !f.inverse }); }
      if (ok) {
        corps.querySelector("#tj-resultat").innerHTML = `<div class="pr-verdict ok">✅ ${ms > delaiRapide() ? "Juste ! Encore un peu plus vite la prochaine fois 🐢" : "Bravo !"}</div>`;
        tablesMinuteur = setTimeout(() => { i += 1; afficher(); }, ms > delaiRapide() ? 1400 : 700);
        return;
      }
      corps.querySelector("#tj-resultat").innerHTML = `<div class="pr-verdict ko">💡 ${f.t} × ${f.n} = ${f.t * f.n}</div>
        <div class="tj-astuce">${astuceFait(f)}</div>
        <button class="btn-primary btn-block" id="tj-suivant">Suivant →</button>`;
      corps.querySelector("#tj-suivant").addEventListener("click", () => { i += 1; afficher(); });
      corps.querySelector("#tj-suivant").focus();
    });
  };
  afficher();
}

// LE BON RÉSULTAT : 3 choix (des pièges voisins), sans faire monter le niveau.
function choixVoisins(f) {
  const r = f.t * f.n;
  const voisins = [f.t * (f.n + 1), f.t * (f.n - 1), (f.t + 1) * f.n, (f.t - 1) * f.n, r + 1, r - 1, r + 10]
    .filter(x => x > 0 && x !== r);
  return melanger([r, ...melanger([...new Set(voisins)]).slice(0, 2)]);
}

function jeuTablesQcm() {
  const serie = serieTables(10);
  const titre = "🔍 Le bon résultat";
  const corps = ouvrirLibre(`<div class="game-head hdr-tqcm"><div class="modal-kicker">${titre}</div><h3 id="tj-compteur"></h3></div><div class="game-body"></div>`);
  const nbFaits = serie.length, rates = [];
  let i = 0, bonnes = 0;
  const afficher = () => {
    if (i >= serie.length) return finJeuTables(corps, titre, bonnes, nbFaits, jeuTablesQcm, rates);
    const f = serie[i];
    const deuxieme = i >= nbFaits;
    const choix = choixVoisins(f);
    corps.querySelector("#tj-compteur").textContent = deuxieme ? "🔁 Deuxième essai" : `${i + 1} / ${nbFaits}`;
    corps.querySelector(".game-body").innerHTML = `<div class="tj-question">${enonce(f)} = ?</div>
      <div class="bonmot-choix tj-choix">${choix.map((c, k) => `<button class="choix-btn bonmot-btn" data-k="${k}">${c}</button>`).join("")}</div>
      <div id="tj-resultat"></div>`;
    corps.querySelectorAll("[data-k]").forEach(b => b.addEventListener("click", () => {
      const ok = choix[Number(b.dataset.k)] === f.t * f.n;
      corps.querySelectorAll("[data-k]").forEach(x => {
        x.disabled = true;
        if (choix[Number(x.dataset.k)] === f.t * f.n) x.classList.add("correct");
        else if (x === b) x.classList.add("incorrect");
      });
      noterFait(f, ok, { donne: b.textContent, rapideCompte: false });
      if (ok && !deuxieme) bonnes += 1;
      if (!ok && !deuxieme) { rates.push(f); serie.push(f); }
      corps.querySelector("#tj-resultat").innerHTML = `${ok ? `<div class="pr-verdict ok">✅ Bien vu !</div>` : `<div class="pr-verdict ko">💡 ${f.t} × ${f.n} = ${f.t * f.n}</div><div class="tj-astuce">${astuceFait(f)}</div>`}
        <button class="btn-primary btn-block" id="tj-suivant">Suivant →</button>`;
      corps.querySelector("#tj-suivant").addEventListener("click", () => { i += 1; afficher(); });
    }));
  };
  afficher();
}

// DÉFI 1 MINUTE : le plus de bonnes réponses possible ; record gardé.
function jeuTablesDefi() {
  const titre = "⏱️ Défi 1 minute";
  const corps = ouvrirLibre(`<div class="game-head hdr-tdefi"><div class="modal-kicker">${titre}</div><h3 id="tj-compteur">Prête ?</h3></div>
    <div class="game-body"><p class="ap-legende">60 secondes pour réussir le plus de calculs des tables ${listeTables(tablesEtat.actives)}.${tablesEtat.record ? ` Ton record : ${tablesEtat.record}.` : ""}</p>
    <button class="btn-primary btn-block" id="tj-go">C'est parti !</button></div>`);
  corps.querySelector("#tj-go").addEventListener("click", () => {
    let bonnes = 0, total = 0, reste = 60;
    const rates = [];
    const fin = Date.now() + 60000;
    const pool = faitsActifs();
    const terminer = () => {
      clearInterval(tablesMinuteur);
      const nouveau = bonnes > tablesEtat.record;
      if (nouveau && !estParent()) { tablesEtat.record = bonnes; enregistrerTables({ record: bonnes }); }
      finJeuTables(corps, nouveau && bonnes ? "🏆 Nouveau record" : titre, bonnes, total, jeuTablesDefi, rates);
    };
    tablesMinuteur = setInterval(() => {
      if (document.getElementById("modal-libre").hidden) return clearInterval(tablesMinuteur);
      reste = Math.max(0, Math.ceil((fin - Date.now()) / 1000));
      const c = corps.querySelector("#tj-compteur");
      if (c) c.textContent = `⏱️ ${reste} s · ${bonnes} ✅`;
      if (reste <= 0) terminer();
    }, 250);
    const question = () => {
      if (Date.now() >= fin || document.getElementById("modal-libre").hidden) return;
      const f = { ...pool[Math.floor(Math.random() * pool.length)], inverse: Math.random() < 0.5 };
      corps.querySelector(".game-body").innerHTML = `<div class="tj-question">${enonce(f)} = ?</div>${HTML_SAISIE}<div id="tj-resultat"></div>`;
      const debut = Date.now();
      const input = champNombre(corps, v => {
        const ok = Number(v) === f.t * f.n;
        total += 1;
        if (ok) bonnes += 1; else if (!rates.some(x => x.t === f.t && x.n === f.n)) rates.push(f);
        noterFait(f, ok, { ms: Date.now() - debut, donne: v });
        if (ok) return question();
        input.disabled = true;
        input.classList.add("incorrect");
        corps.querySelector("#tj-resultat").innerHTML = `<div class="pr-verdict ko">${f.t} × ${f.n} = ${f.t * f.n}</div>`;
        setTimeout(question, 1200);
      });
    };
    question();
  });
}

// CALCUL QUI TOMBE : le calcul descend vers la ligne, il faut répondre avant qu'il la touche.
// Une bonne réponse accélère un peu la chute suivante ; raté = la réponse correcte s'affiche puis on enchaîne.
function jeuTablesChute() {
  const titre = "🪂 Ça tombe !";
  const corps = ouvrirLibre(`<div class="game-head hdr-tchute"><div class="modal-kicker">${titre}</div><h3 id="tj-compteur">Prête ?</h3></div>
    <div class="game-body"><p class="ap-legende">60 secondes : réponds avant que le calcul touche la ligne !</p>
    <button class="btn-primary btn-block" id="tj-go">C'est parti !</button></div>`);
  corps.querySelector("#tj-go").addEventListener("click", () => {
    let bonnes = 0, total = 0, fallMs = 6000, arrete = false;
    const rates = [];
    const fin = Date.now() + 60000;
    const terminer = () => {
      arrete = true;
      clearInterval(tablesMinuteur);
      const nouveau = bonnes > (tablesEtat.recordChute || 0);
      if (nouveau && !estParent()) { tablesEtat.recordChute = bonnes; enregistrerTables({ recordChute: bonnes }); }
      finJeuTables(corps, nouveau && bonnes ? "🏆 Nouveau record" : titre, bonnes, total, jeuTablesChute, rates);
    };
    tablesMinuteur = setInterval(() => {
      if (arrete || document.getElementById("modal-libre").hidden) return clearInterval(tablesMinuteur);
      const reste = Math.max(0, Math.ceil((fin - Date.now()) / 1000));
      const c = corps.querySelector("#tj-compteur");
      if (c) c.textContent = `⏱️ ${reste} s · ${bonnes} ✅`;
      if (reste <= 0) terminer();
    }, 250);
    const question = () => {
      if (arrete || Date.now() >= fin || document.getElementById("modal-libre").hidden) return;
      const f = serieTables(1)[0];
      let reglee = false;
      corps.querySelector(".game-body").innerHTML = `
        <div class="chute-zone"><div class="chute-ligne"></div>
          <div class="chute-item" id="chute-item" style="animation-duration:${fallMs}ms">${enonce(f)} = ?</div>
        </div>${HTML_SAISIE}<div id="tj-resultat"></div>`;
      const item = corps.querySelector("#chute-item");
      const debut = Date.now();
      item.addEventListener("animationend", () => {
        if (reglee || arrete) return;
        reglee = true;
        total += 1;
        if (!rates.some(x => x.t === f.t && x.n === f.n)) rates.push(f);
        noterFait(f, false, { ms: fallMs, donne: "" });
        item.classList.add("ko");
        corps.querySelector("#tj-resultat").innerHTML = `<div class="pr-verdict ko">⌛ ${f.t} × ${f.n} = ${f.t * f.n}</div>`;
        corps.querySelector("#tj-saisie").disabled = true;
        corps.querySelector("#tj-ok").disabled = true;
        setTimeout(question, 900);
      });
      champNombre(corps, v => {
        if (reglee || arrete) return;
        reglee = true;
        const ms = Date.now() - debut;
        const ok = Number(v) === f.t * f.n;
        total += 1;
        if (ok) { bonnes += 1; fallMs = Math.max(2500, fallMs - 120); }
        else if (!rates.some(x => x.t === f.t && x.n === f.n)) rates.push(f);
        noterFait(f, ok, { ms, donne: v });
        corps.querySelector("#tj-saisie").disabled = true;
        corps.querySelector("#tj-ok").disabled = true;
        corps.querySelector("#tj-saisie").classList.add(ok ? "correct" : "incorrect");
        item.classList.add(ok ? "ok" : "ko");
        corps.querySelector("#tj-resultat").innerHTML = ok
          ? `<div class="pr-verdict ok">✅ Bravo !</div>`
          : `<div class="pr-verdict ko">${f.t} × ${f.n} = ${f.t * f.n}</div>`;
        setTimeout(question, ok ? 500 : 1100);
      });
    };
    question();
  });
}

// ------------------------------------------------------------
// CONTRÔLES / DST — échéances par élève (saisies par le parent), priorité automatique 7 jours avant
// ------------------------------------------------------------
const echeancesCache = {};

async function echeancesDe(eleve) {
  if (!eleve) return [];
  if (echeancesCache[eleve]) return echeancesCache[eleve];
  try {
    const snap = await getDoc(doc(db, "echeancesRevisions", eleve));
    echeancesCache[eleve] = snap.exists() ? (snap.data().liste || []) : [];
  } catch (err) {
    console.error("Échéances", err);
    echeancesCache[eleve] = [];
  }
  return echeancesCache[eleve];
}

function dateFr(iso, opts = { day: "numeric", month: "short" }) {
  return new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", opts);
}

function quandControle(e) {
  const auj = todayISO();
  if (e.debut <= auj && e.fin >= auj) return { cls: "ct-maintenant", txt: "cette semaine" };
  const jours = Math.round((Date.parse(e.debut + "T12:00:00") - Date.parse(auj + "T12:00:00")) / 86400000);
  if (jours <= 7) return { cls: "ct-bientot", txt: jours <= 1 ? "lundi prochain" : `dans ${jours} jours` };
  if (jours <= 21) return { cls: "ct-proche", txt: `dans ${Math.round(jours / 7)} semaine${jours >= 11 ? "s" : ""}` };
  return { cls: "", txt: `le ${dateFr(e.debut, { day: "numeric", month: "long" })}` };
}

function libelleControle(e) {
  return e.matiere ? `${MATIERES_UI[e.matiere]?.emoji || ""} ${MATIERES_UI[e.matiere]?.nom || e.libelle}` : `📌 ${e.libelle}`;
}

function controleProche(liste, matiere) {
  const auj = todayISO();
  const dans7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  return liste.find(e => e.matiere === matiere && e.fin >= auj && e.debut <= dans7) || null;
}

async function afficherBandeauControle() {
  const el = document.getElementById("dst-bandeau");
  if (!el) return;
  const eleve = eleveCourant, matiere = matiereCourante;
  const c = controleProche(await echeancesDe(eleve), matiere);
  if (eleve !== eleveCourant || matiere !== matiereCourante) return;
  if (!c) { el.hidden = true; return; }
  const aRevoir = Object.values(notionsById).filter(n => (n.matiere || "anglais") === matiere && n.type !== "figure" && (n.niveau || 0) < 3).length;
  el.hidden = false;
  el.innerHTML = `📅 <b>${esc(c.libelle)} ${quandControle(c).txt}</b> (semaine du ${dateFr(c.debut)} au ${dateFr(c.fin)}) — tes séances reprennent en priorité les notions pas encore sues${aRevoir ? ` : <b>${aRevoir} à revoir</b>` : ""}. Pense aussi au 📝 Contrôle blanc dans S'entraîner !`;
}

async function loadControles() {
  const el = document.getElementById("controles-contenu");
  const eleve = eleveCourant;
  const [liste, progSnap, coursSnap] = await Promise.all([
    echeancesDe(eleve),
    getDocs(query(collection(db, "progressionAnglais"), where("eleve", "==", eleve))),
    getDocs(query(collection(db, "coursAnglais"), where("eleve", "==", eleve))),
  ]);
  if (eleve !== eleveCourant) return;
  const prog = progSnap.docs.map(d => d.data()).filter(n => n.type !== "figure");
  const cours = coursSnap.docs.map(d => d.data());
  const auj = todayISO();
  const aVenir = liste.filter(e => e.fin >= auj).sort((a, b) => a.debut.localeCompare(b.debut));
  const passes = liste.filter(e => e.fin < auj).sort((a, b) => b.debut.localeCompare(a.debut));
  const ligne = (e, passe) => {
    const q = quandControle(e);
    const notions = e.matiere ? prog.filter(n => n.matiere === e.matiere) : [];
    const sus = notions.filter(n => (n.niveau || 0) >= 3).length;
    const nbCours = e.matiere ? cours.filter(c => c.matiere === e.matiere).length : 0;
    const etat = !e.matiere ? "" : !nbCours
      ? `<span class="ct-alerte">⚠️ Aucun cours importé : ajoute-le pour réviser</span>`
      : `<span class="ct-etat">${sus} / ${notions.length} notions sues</span>`;
    return `<div class="ct-ligne${passe ? " ct-passe" : ""}">
      <div class="ct-date"><b>${dateFr(e.debut)}</b><span>au ${dateFr(e.fin)}</span></div>
      <div class="ct-info"><div class="ct-mat">${esc(libelleControle(e))}</div>${passe ? "" : etat}</div>
      ${passe ? "" : `<span class="ct-quand ${q.cls}">${q.txt}</span>`}
      ${!passe && e.matiere && eleveInfo()?.matieres.includes(e.matiere) ? `<button class="btn-ghost-small ct-go" data-reviser="${e.matiere}">${nbCours ? "Réviser →" : "+ Ajouter le cours"}</button>` : ""}
    </div>`;
  };
  el.innerHTML = liste.length ? `
    <div class="ct-hero"><div class="dic-kicker">📅 Contrôles & DST</div>
      <h2>${aVenir[0] ? `Prochain : ${esc(libelleControle(aVenir[0]))}, ${quandControle(aVenir[0]).txt}` : "Plus de contrôle prévu"}</h2>
      <div class="dic-sub">7 jours avant chaque contrôle, les séances du jour de la matière reprennent en priorité tout ce qui n'est pas encore su.</div></div>
    <h3 class="section-title">À venir <span>${aVenir.length}</span></h3>
    <div class="ct-liste">${aVenir.map(e => ligne(e, false)).join("")}</div>
    ${passes.length ? `<details class="dic-archive"><summary><b>Déjà passés</b> <span class="muted">· ${passes.length}</span></summary><div class="ct-liste">${passes.map(e => ligne(e, true)).join("")}</div></details>` : ""}`
    : `<div class="panel-info">Aucun contrôle enregistré pour l'instant.</div>`;
  el.querySelectorAll("[data-reviser]").forEach(b => b.addEventListener("click", () => {
    choisirContexte(eleveCourant, b.dataset.reviser);
    const avecCours = cours.some(c => c.matiere === b.dataset.reviser);
    document.querySelector(`.tab-btn[data-tab="${avecCours ? (estParent() ? "notions" : "today") : "add"}"]`).click();
  }));
}

// RÉCAP PARENT (aperçu)
sur("btn-recap-test", "click", async (e) => {
  const btn = e.currentTarget;
  const status = document.getElementById("recap-status");
  btn.disabled = true;
  status.textContent = "Envoi…";
  try {
    const recapAnglaisTest = httpsCallable(functions, "recapAnglaisTest", { timeout: 60000 });
    const r = await recapAnglaisTest({}).then(res => res.data);
    status.textContent = `✅ Aperçu envoyé à ${r.destinataire}`;
  } catch (err) {
    console.error(err);
    status.textContent = "❌ Envoi impossible";
  } finally {
    btn.disabled = false;
  }
});

// ------------------------------------------------------------
// TABLEAU DE BORD PARENT (lecture seule)
// ------------------------------------------------------------
function serieDe(reponses) {
  const jours = new Set(reponses.map(r => r.date));
  let serie = 0;
  const d = new Date();
  if (!jours.has(todayISO())) d.setDate(d.getDate() - 1);
  while (jours.has(d.toISOString().slice(0, 10))) { serie += 1; d.setDate(d.getDate() - 1); }
  return { serie, aujourdhui: jours.has(todayISO()) };
}

// Temps de travail estimé à partir de l'heure des réponses : une pause de plus de 10 min = nouvelle session,
// chaque session compte (dernière − première réponse) + 1 min.
function minutesTravail(reponses) {
  const t = reponses.map(r => Date.parse(r.at)).filter(Boolean).sort((a, b) => a - b);
  if (!t.length) return 0;
  let total = 0, debut = t[0], prec = t[0];
  for (const x of t.slice(1)) {
    if (x - prec > 600000) { total += prec - debut + 60000; debut = x; }
    prec = x;
  }
  total += prec - debut + 60000;
  return Math.round(total / 60000);
}

function dureeTexte(min) {
  if (!min) return "0 min";
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

function tauxReussite(reps) {
  return reps.length ? Math.round(reps.filter(r => r.correct).length / reps.length * 100) : null;
}

// Les notions les moins sues d'une matière : ratées la dernière fois, puis vues mais encore faibles.
function notionsARetravailler(prog, n = 6) {
  const rang = x => (x.dernierResultat === false ? 0 : 1) * 10 + (x.niveau || 0);
  return prog.filter(x => x.type !== "figure" && (x.dernierResultat === false || (x.dernierVu && (x.niveau || 0) <= 1)))
    .sort((a, b) => rang(a) - rang(b)).slice(0, n);
}

async function carteEnfant(e) {
  const [progSnap, seanceSnap, repSnap, tablesSnap, echeances] = await Promise.all([
    getDocs(query(collection(db, "progressionAnglais"), where("eleve", "==", e.uid))),
    getDocs(query(collection(db, "seancesAnglais"), where("eleve", "==", e.uid))),
    getDocs(query(collection(db, "reponsesAnglais"), where("eleve", "==", e.uid))),
    getDoc(doc(db, "tablesRevisions", e.uid)).catch(() => null),
    echeancesDe(e.uid),
  ]);
  const prochains = echeances.filter(x => x.fin >= todayISO()).sort((a, b) => a.debut.localeCompare(b.debut)).slice(0, 3);
  const progression = progSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const coursParMatiere = new Set(progression.map(n => n.matiere));
  const seances = seanceSnap.docs.map(d => d.data()).sort((a, b) => (b.finieLe || "").localeCompare(a.finieLe || ""));
  const reponses = repSnap.docs.map(d => d.data());
  const tables = tablesSnap?.exists() ? tablesSnap.data() : null;
  const depuis = new Date(Date.now() - 7 * 86400000).toISOString();
  const depuis14 = new Date(Date.now() - 14 * 86400000).toISOString();
  const semaine = reponses.filter(r => r.at >= depuis);
  const avant = reponses.filter(r => r.at >= depuis14 && r.at < depuis);
  const joursSemaine = new Set(semaine.map(r => r.date)).size;
  const reussite = tauxReussite(semaine);
  const { serie, aujourdhui } = serieDe(reponses);
  const derniere = reponses.reduce((m, r) => (r.at > m ? r.at : m), "");
  const mat = m => x => (x.matiere || "anglais") === m;
  const minutesSemaine = e.matieres.reduce((s, m) => s + minutesTravail(semaine.filter(mat(m))), 0);

  const blocs = e.matieres.map(m => {
    const repS = semaine.filter(mat(m));
    const repA = avant.filter(mat(m));
    const min = minutesTravail(repS);
    const taux = tauxReussite(repS), tauxAvant = tauxReussite(repA);
    const evol = taux !== null && tauxAvant !== null ? taux - tauxAvant : null;
    let maitrise = null, faibles = "", vide = false;
    if (m === "tables") {
      const faits = Object.entries(tables?.faits || {});
      const actifs = (tables?.actives || []).flatMap(t => Array.from({ length: 10 }, (_, k) => `${t}x${k + 1}`));
      maitrise = actifs.length ? Math.round(actifs.filter(k => (tables.faits?.[k]?.niveau || 0) >= 3).length / actifs.length * 100) : null;
      const pires = faits.filter(([, x]) => x.dernierResultat === false || (x.rates > 0 && x.niveau < 3))
        .sort((a, b) => (b[1].rates - a[1].rates) || (a[1].niveau - b[1].niveau)).slice(0, 8);
      faibles = pires.map(([k, x]) => `<span class="dash-ko-item">${k.replace("x", " × ")} = ${k.split("x").reduce((p, v) => p * Number(v), 1)}${x.rates > 1 ? ` · raté ${x.rates}×` : ""}</span>`).join("");
      vide = !faits.length;
    } else {
      const prog = progression.filter(mat(m)).filter(x => x.type !== "figure");
      maitrise = prog.length ? Math.round(prog.reduce((s, n) => s + (n.niveau || 0), 0) / (prog.length * 5) * 100) : null;
      faibles = notionsARetravailler(prog).map(n => `<button class="dash-ko-item dash-ko-btn" data-notion="${esc(n.id)}">${n.dernierResultat === false ? "✗ " : ""}${esc(n.label)}</button>`).join("");
      vide = !prog.length;
    }
    if (vide && !repS.length) return { vide: true, html: `<span class="dash-vide">${MATIERES_UI[m].emoji} ${MATIERES_UI[m].nom}</span>` };
    return { vide: false, min, html: `<div class="dash-mat">
      <button class="dash-mat-head" data-voir="${esc(e.uid)}|${m}">
        <span class="dm-nom">${MATIERES_UI[m].emoji} ${MATIERES_UI[m].nom}</span>
        <span class="dm-chiffre" title="Temps estimé sur 7 jours">⏱️ ${dureeTexte(min)}</span>
        <span class="dm-chiffre" title="Réussite sur 7 jours">${taux === null ? "—" : `✅ ${taux} %`}${evol ? ` <span class="${evol > 0 ? "dm-up" : "dm-down"}">${evol > 0 ? "▲" : "▼"} ${Math.abs(evol)}</span>` : ""}</span>
      </button>
      <div class="dm-maitrise"><span class="dm-bar"><span style="width:${maitrise || 0}%"></span></span><span class="dm-pct">${maitrise === null ? "—" : `${maitrise} % su`}</span></div>
      ${faibles ? `<div class="dm-faibles"><span class="dm-faibles-titre">À retravailler :</span>${faibles}</div>` : repS.length ? `<div class="dm-faibles dm-ok">👍 Rien de raté récemment</div>` : `<div class="dm-faibles dm-rien">Pas travaillé cette semaine</div>`}
    </div>` };
  });
  const actifs = blocs.filter(b => !b.vide).sort((a, b) => b.min - a.min);
  const vides = blocs.filter(b => b.vide);

  return `<div class="dash-carte">
    <div class="dash-head">
      <div><div class="dash-nom">${esc(e.prenom)}</div>
        <div class="dash-sous">${e.niveau === "ce2" ? "CE2" : "Collège"} · ${derniere ? `dernière activité le ${new Date(derniere).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}` : "pas encore d'activité"}</div></div>
      ${serie ? `<span class="streak${aujourdhui ? "" : " streak-attente"}">🔥 ${serie}</span>` : ""}
    </div>
    <div class="stats-row dash-stats">
      <div class="stat"><div class="stat-val">${joursSemaine}<span>/7</span></div><div class="stat-lbl">jours actifs</div></div>
      <div class="stat"><div class="stat-val">${dureeTexte(minutesSemaine)}</div><div class="stat-lbl">de travail (7 j)</div></div>
      <div class="stat"><div class="stat-val">${semaine.length}</div><div class="stat-lbl">réponses (7 j)</div></div>
      <div class="stat"><div class="stat-val">${reussite === null ? "—" : `${reussite}<span>%</span>`}</div><div class="stat-lbl">de réussite</div></div>
    </div>
    ${prochains.length ? `<div class="exemples-title">📅 Prochains contrôles</div><div class="dash-ct">${prochains.map(x => `<div class="dash-ct-ligne"><span class="ct-quand ${quandControle(x).cls}">${quandControle(x).txt}</span><span>${esc(libelleControle(x))}</span>${x.matiere && !coursParMatiere.has(x.matiere) ? `<span class="ct-alerte">⚠️ aucun cours importé</span>` : ""}</div>`).join("")}</div>` : ""}
    <div class="exemples-title">Par matière <span class="astuce">· 7 derniers jours, ▲▼ = par rapport à la semaine d'avant · clique sur une notion pour la revoir avec elle</span></div>
    <div class="dash-mats">${actifs.map(b => b.html).join("")}</div>
    ${vides.length ? `<div class="dash-vides">Pas encore commencé : ${vides.map(b => b.html).join("")}</div>` : ""}
    ${seances.length ? `<div class="exemples-title">Dernières séances</div><div class="dash-seances">${seances.slice(0, 5).map(s => `<div class="dash-seance">
      <span>${esc(new Date(s.finieLe || s.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }))}</span>
      <span>${MATIERES_UI[s.matiere || "anglais"]?.emoji || ""} ${s.type === "vitesse" ? "Jeu de vitesse" : "Séance du jour"}</span>
      <span class="dash-score">${s.type === "vitesse" ? `${s.score} pts` : `${s.score}/${s.total}`}</span>
    </div>`).join("")}</div>` : ""}
    ${graphiqueActivite(reponses)}
  </div>`;
}

async function loadDashboard() {
  if (!estParent()) return;
  const zone = document.getElementById("dashboard-contenu");
  zone.innerHTML = `<div class="panel-info">Chargement…</div>`;
  try {
    const cartes = await Promise.all(profil.eleves.map(carteEnfant));
    zone.innerHTML = `<div class="dash-grid">${cartes.join("")}</div>`;
    zone.querySelectorAll("[data-voir]").forEach(b => b.addEventListener("click", () => {
      const [uid, m] = b.dataset.voir.split("|");
      choisirContexte(uid, m);
      const notions = document.querySelector('.tab-btn[data-tab="notions"]');
      if (!notions.hidden) notions.click();
    }));
    zone.querySelectorAll("[data-notion]").forEach(b => b.addEventListener("click", () => openNotionModal(b.dataset.notion)));
  } catch (err) {
    console.error(err);
    zone.innerHTML = `<div class="panel-info">❌ Impossible de charger le tableau de bord.</div>`;
  }
}

sur("btn-recap-test-dash", "click", async (e) => {
  const btn = e.currentTarget;
  const status = document.getElementById("recap-status-dash");
  btn.disabled = true;
  status.textContent = "Envoi…";
  try {
    const recapAnglaisTest = httpsCallable(functions, "recapAnglaisTest", { timeout: 60000 });
    const r = await recapAnglaisTest({}).then(res => res.data);
    status.textContent = `✅ Aperçu envoyé à ${r.destinataire}`;
  } catch (err) {
    console.error(err);
    status.textContent = "❌ Envoi impossible";
  } finally {
    btn.disabled = false;
  }
});

// ------------------------------------------------------------
// SCHÉMAS & CARTES À COMPLÉTER
// ------------------------------------------------------------
const MATIERES_FIGURES = ["svt", "histoire", "physique"];
let figuresById = {};
let pdfjsPret = null;

function chargerPdfJs() {
  if (!pdfjsPret) {
    pdfjsPret = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve(window.pdfjsLib);
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return pdfjsPret;
}

async function pagesDepuisSources(sources) {
  const pages = [];
  for (const s of sources) {
    if (s.mimeType === "application/pdf") {
      const lib = await chargerPdfJs();
      const octets = Uint8Array.from(atob(s.data), c => c.charCodeAt(0));
      const pdf = await lib.getDocument({ data: octets }).promise;
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const vp = page.getViewport({ scale: 1.6 });
        const c = document.createElement("canvas");
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
        pages.push(c.toDataURL("image/jpeg", 0.85));
      }
    } else {
      pages.push(`data:${s.mimeType};base64,${s.data}`);
    }
  }
  return pages;
}

function recadrer(dataUrl, rect, maxDim = 1100, qualite = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const sx = rect.x * img.naturalWidth, sy = rect.y * img.naturalHeight;
      const sw = rect.w * img.naturalWidth, sh = rect.h * img.naturalHeight;
      const ratio = Math.min(1, maxDim / Math.max(sw, sh));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(sw * ratio)); c.height = Math.max(1, Math.round(sh * ratio));
      c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", qualite));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// Pages du cours gardées (une par doc, < 1 Mo) pour préparer les schémas plus tard sans nouvelle photo.
async function enregistrerPagesCours(coursId, pages) {
  if (!coursId || !pages.length) return;
  const eleve = eleveCourant, matiere = matiereCourante;
  for (let i = 0; i < pages.length; i++) {
    let image = "";
    for (const [dim, q] of [[1600, 0.8], [1300, 0.7], [1000, 0.6]]) {
      image = await recadrer(pages[i], { x: 0, y: 0, w: 1, h: 1 }, dim, q);
      if (image.length < 900000) break;
    }
    await setDoc(doc(db, "pagesCours", `${coursId}_p${i + 1}`), {
      eleve, matiere, coursId, page: i + 1, image, dateAjout: new Date().toISOString(),
    });
  }
}

async function chargerPagesCours(coursId) {
  const snap = await getDocs(query(collection(db, "pagesCours"), where("eleve", "==", eleveCourant), where("coursId", "==", coursId)));
  return snap.docs.map(d => d.data()).sort((a, b) => a.page - b.page).map(p => p.image);
}

function choisirFichiersCours() {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,application/pdf";
    input.multiple = true;
    input.addEventListener("change", async () => {
      const sources = [];
      for (const file of input.files) {
        if (file.type === "application/pdf") sources.push({ mimeType: "application/pdf", data: await fileToBase64(file) });
        else sources.push(await resizeImage(file, 1600, 0.85));
      }
      resolve(sources);
    });
    input.click();
  });
}

// Tracé d'un rectangle (souris ou doigt) sur une image ; coordonnées normalisées 0-1.
function zoneDeSelection(stage, onRect) {
  const sel = document.createElement("div");
  sel.className = "fig-sel";
  sel.hidden = true;
  stage.style.touchAction = "none";
  stage.appendChild(sel);
  let depart = null;
  const pos = e => {
    const r = stage.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const norm = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  const majSel = (a, b) => {
    const r = norm(a, b);
    Object.assign(sel.style, { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });
  };
  stage.addEventListener("pointerdown", e => {
    if (e.target.closest("button")) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    depart = pos(e);
    majSel(depart, depart);
    sel.hidden = false;
  });
  stage.addEventListener("pointermove", e => { if (depart) majSel(depart, pos(e)); });
  stage.addEventListener("pointerup", e => {
    if (!depart) return;
    const rect = norm(depart, pos(e));
    depart = null;
    sel.hidden = true;
    if (rect.w > 0.01 && rect.h > 0.01) onRect(rect);
  });
}

async function enregistrerFigure({ coursId, titre, type, image, legendes }) {
  const ref = await addDoc(collection(db, "figuresRevisions"), {
    eleve: eleveCourant, matiere: matiereCourante, coursId: coursId || null,
    titre, type, image, legendes, dateAjout: new Date().toISOString(),
  });
  await setDoc(doc(db, "progressionAnglais", `fig_${ref.id}`), {
    eleve: eleveCourant, matiere: matiereCourante, coursId: coursId || null,
    type: "figure", label: titre, figureId: ref.id,
    niveau: 0, dernierResultat: null, prochaineDate: todayISO(), dernierVu: null,
  });
  return ref.id;
}

async function supprimerFigure(id) {
  await deleteDoc(doc(db, "figuresRevisions", id));
  await deleteDoc(doc(db, "progressionAnglais", `fig_${id}`));
}

// L'IA localise le cadre de la figure et le texte de chaque légende sur la page ;
// on recadre et on convertit les boîtes dans le repère de l'image recadrée.
async function preparerFigureAuto(pageDataUrl, figure) {
  const envoi = await recadrer(pageDataUrl, { x: 0, y: 0, w: 1, h: 1 }, 1600);
  const localiser = httpsCallable(functions, "localiserFigureRevisions", { timeout: 120000 });
  const r = await localiser({ eleve: eleveCourant, image: envoi.split(",")[1], titre: figure.titre || "", legendes: figure.legendes || [] }).then(x => x.data);
  const quarts = ((Math.round((Number(r.rotation) || 0) / 90) % 4) + 4) % 4;
  const tournerBoite = b => ({ x0: 1000 - b.y1, x1: 1000 - b.y0, y0: b.x0, y1: b.x1 });
  for (let t = 0; t < quarts; t++) {
    pageDataUrl = await tournerImage(pageDataUrl);
    r.figure = tournerBoite(r.figure);
    r.legendes = r.legendes.map(l => ({ texte: l.texte, ...tournerBoite(l) }));
  }
  const marge = 0.02;
  const f = r.figure;
  const rect = {
    x: Math.max(0, f.x0 / 1000 - marge), y: Math.max(0, f.y0 / 1000 - marge),
    w: 0, h: 0,
  };
  rect.w = Math.min(1, f.x1 / 1000 + marge) - rect.x;
  rect.h = Math.min(1, f.y1 / 1000 + marge) - rect.y;
  if (rect.w < 0.05 || rect.h < 0.05) throw new Error("Figure non localisée");
  const pad = 0.004;
  const clamp = v => Math.min(1, Math.max(0, v));
  const legendes = separerCases(r.legendes.map(l => {
    const x0 = clamp((l.x0 / 1000 - pad - rect.x) / rect.w), y0 = clamp((l.y0 / 1000 - pad - rect.y) / rect.h);
    const x1 = clamp((l.x1 / 1000 + pad - rect.x) / rect.w), y1 = clamp((l.y1 / 1000 + pad - rect.y) / rect.h);
    return { texte: l.texte, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }).filter(l => l.w > 0.01 && l.h > 0.01));
  if (legendes.length < 2) throw new Error("Légendes non localisées");
  return { titre: figure.titre || "Figure", type: figure.type || "schema", image: await imageFigure(pageDataUrl, rect), legendes };
}

async function imageFigure(page, rect) {
  for (const [dim, q] of [[1600, 0.85], [1300, 0.78], [1000, 0.7]]) {
    const im = await recadrer(page, rect, dim, q);
    if (im.length < 800000) return im;
  }
  return recadrer(page, rect, 800, 0.6);
}

// Deux cases qui se chevauchent sont coupées au milieu de leur zone commune.
function separerCases(cases) {
  const l = cases.map(c => ({ ...c }));
  const ecart = 0.004;
  const couper = (a, b, pos, taille) => {
    const [avant, apres] = a[pos] <= b[pos] ? [a, b] : [b, a];
    const milieu = (Math.max(avant[pos], apres[pos]) + Math.min(avant[pos] + avant[taille], apres[pos] + apres[taille])) / 2;
    const finApres = apres[pos] + apres[taille];
    avant[taille] = Math.max(0.006, milieu - ecart / 2 - avant[pos]);
    apres[pos] = Math.min(milieu + ecart / 2, finApres - 0.006);
    apres[taille] = finApres - apres[pos];
  };
  for (let passe = 0; passe < 3; passe++) {
    for (let i = 0; i < l.length; i++) {
      for (let j = i + 1; j < l.length; j++) {
        const a = l[i], b = l[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox <= 0 || oy <= 0) continue;
        if (oy <= ox) couper(a, b, "y", "h");
        else couper(a, b, "x", "w");
      }
    }
  }
  return l;
}

async function tournerFigure(fig) {
  return {
    ...fig,
    image: await tournerImage(fig.image),
    legendes: fig.legendes.map(l => ({ ...l, x: 1 - (l.y + l.h), y: l.x, w: l.h, h: l.w })),
  };
}

function avecZoom(stage) {
  const bloc = document.createElement("div");
  const zone = document.createElement("div");
  zone.className = "fig-zoom";
  zone.appendChild(stage);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-ghost-small fig-zoom-btn";
  btn.textContent = "🔍 Agrandir";
  btn.addEventListener("click", () => {
    const grand = zone.classList.toggle("zoome");
    btn.textContent = grand ? "🔍 Réduire" : "🔍 Agrandir";
  });
  bloc.append(btn, zone);
  return bloc;
}

function tournerImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalHeight; c.height = img.naturalWidth;
      const ctx = c.getContext("2d");
      ctx.translate(c.width, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, 0, 0);
      resolve(c.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function apercuFigure(fig) {
  const stage = document.createElement("div");
  stage.className = "fig-stage fig-apercu";
  stage.innerHTML = `<img src="${fig.image}" class="fig-img" alt="" draggable="false">`;
  fig.legendes.forEach((l, n) => {
    const b = document.createElement("div");
    b.className = "fig-masque rempli";
    Object.assign(b.style, { left: `${l.x * 100}%`, top: `${l.y * 100}%`, width: `${l.w * 100}%`, height: `${l.h * 100}%` });
    b.innerHTML = `<span class="fig-num">${n + 1}</span>`;
    stage.appendChild(b);
  });
  return stage;
}

// Assistant de configuration : image → recadrage → légendes → placement. Résout "ok" | "passe".
function assistantFigure({ coursId, figure = {}, pages = [], rang = "", manuel = false }) {
  return new Promise(resolve => {
    const corps = document.getElementById("modal-libre-corps");
    document.getElementById("modal-libre").hidden = false;
    const entete = etape => `<div class="game-head hdr-figure"><div class="modal-kicker">🗺️ ${rang ? `Figure ${esc(rang)} · ` : ""}${esc(etape)}</div><h3>${esc(figure.titre || "Nouveau schéma ou carte")}</h3></div>`;
    let image = null, recadree = null;

    const etapeSource = () => {
      corps.innerHTML = `${entete("1. Choisis l'image")}<div class="game-body">
        ${pages.length ? `<p class="muted">Sur quelle page se trouve la figure ?</p><div class="fig-pages">${pages.map((p, i) => `<button class="fig-page${figure.page === i + 1 ? " suggeree" : ""}" data-page="${i}"><img src="${p}" alt=""><span>Page ${i + 1}${figure.page === i + 1 ? " · proposée" : ""}</span></button>`).join("")}</div>` : ""}
        <label class="btn-ghost-small fig-upload">📷 ${pages.length ? "Utiliser une autre photo" : "Choisir une photo de la figure"}<input type="file" accept="image/*" hidden></label>
        <div class="fig-nav"><button class="btn-ghost-small" id="fig-passer">Passer cette figure</button></div></div>`;
      corps.querySelectorAll("[data-page]").forEach(b => b.addEventListener("click", () => { image = pages[Number(b.dataset.page)]; apresChoixImage(); }));
      corps.querySelector(".fig-upload input").addEventListener("change", async e => {
        const f = e.target.files[0];
        if (!f) return;
        const r = await resizeImage(f, 2000, 0.9);
        image = `data:${r.mimeType};base64,${r.data}`;
        apresChoixImage();
      });
      corps.querySelector("#fig-passer").addEventListener("click", () => resolve("passe"));
    };

    const apresChoixImage = () => (manuel ? etapeCadrage() : etapeAuto());

    const etapeAuto = async () => {
      corps.innerHTML = `${entete("Préparation automatique")}<div class="game-body"><div class="loading-exos">✂️ L'IA repère le schéma et cache les légendes…</div></div>`;
      let prete;
      try {
        prete = await preparerFigureAuto(image, figure);
      } catch (err) {
        console.error(err);
        etapeCadrage();
        corps.querySelector(".game-body").insertAdjacentHTML("afterbegin", `<p class="pr-verdict ko">L'IA n'a pas réussi à placer les cases : fais-le à la main, c'est rapide.</p>`);
        return;
      }
      const afficher = () => {
        corps.innerHTML = `${entete("Vérifie le schéma vierge")}<div class="game-body">
          <p class="muted">Chaque légende doit être cachée par une case numérotée.</p>
          <div id="fig-apercu-auto"></div>
          <button class="btn-primary btn-block" id="fig-ok-auto">✅ C'est bon, enregistrer</button>
          <div class="fig-nav"><button class="btn-ghost-small" id="fig-tourner-auto">↻ Tourner</button><button class="btn-ghost-small" id="fig-manuel">✋ Faire à la main</button></div></div>`;
        corps.querySelector("#fig-apercu-auto").appendChild(avecZoom(apercuFigure(prete)));
        corps.querySelector("#fig-tourner-auto").addEventListener("click", async () => { prete = await tournerFigure(prete); afficher(); });
        corps.querySelector("#fig-manuel").addEventListener("click", etapeCadrage);
        corps.querySelector("#fig-ok-auto").addEventListener("click", async e => {
          const btn = e.currentTarget;
          btn.disabled = true;
          btn.textContent = "Enregistrement…";
          try {
            await enregistrerFigure({ coursId, ...prete });
            resolve("ok");
          } catch (err) {
            console.error(err);
            btn.disabled = false;
            btn.textContent = "❌ Échec, réessayer";
          }
        });
      };
      afficher();
    };

    const etapeCadrage = () => {
      corps.innerHTML = `${entete("2. Recadre la figure")}<div class="game-body">
        <p class="muted">Trace un rectangle autour de la figure (clic-glisser, ou au doigt).</p>
        <div class="fig-stage"><img src="${image}" class="fig-img" alt="" draggable="false"></div>
        <div class="fig-nav"><button class="btn-ghost-small" id="fig-retour">← Retour</button><button class="btn-ghost-small" id="fig-tourner">↻ Tourner</button><button class="btn-ghost-small" id="fig-tout">Garder toute l'image</button></div></div>`;
      corps.querySelector("#fig-retour").addEventListener("click", etapeSource);
      corps.querySelector("#fig-tourner").addEventListener("click", async () => { image = await tournerImage(image); etapeCadrage(); });
      const suite = async rect => { recadree = await imageFigure(image, rect); etapeLegendes(); };
      corps.querySelector("#fig-tout").addEventListener("click", () => suite({ x: 0, y: 0, w: 1, h: 1 }));
      zoneDeSelection(corps.querySelector(".fig-stage"), suite);
    };

    const etapeLegendes = () => {
      corps.innerHTML = `${entete("3. Les légendes")}<div class="game-body">
        <label class="fig-label">Titre<input type="text" id="fig-titre" value="${esc(figure.titre || "")}" placeholder="ex : Le cœur humain"></label>
        <label class="fig-label">Légendes à apprendre (une par ligne)<textarea id="fig-legendes" rows="6">${esc((figure.legendes || []).join("\n"))}</textarea></label>
        <div class="fig-nav"><button class="btn-ghost-small" id="fig-retour">← Retour</button><button class="btn-primary btn-small" id="fig-placer">Placer les légendes →</button></div></div>`;
      corps.querySelector("#fig-retour").addEventListener("click", etapeCadrage);
      corps.querySelector("#fig-placer").addEventListener("click", () => {
        figure.titre = corps.querySelector("#fig-titre").value.trim() || "Figure";
        const textes = corps.querySelector("#fig-legendes").value.split("\n").map(s => s.trim()).filter(Boolean);
        if (textes.length >= 2) etapePlacement(textes);
      });
    };

    const etapePlacement = textes => {
      const placees = [];
      const historique = [];
      let i = 0;
      corps.innerHTML = `${entete("4. Encadre chaque légende")}<div class="game-body">
        <p class="fig-consigne" id="fig-consigne"></p>
        <div class="fig-stage"><img src="${recadree}" class="fig-img" alt="" draggable="false"></div>
        <div class="fig-nav"><button class="btn-ghost-small" id="fig-annuler">↺ Annuler</button><button class="btn-ghost-small" id="fig-sauter">Pas visible, passer</button></div>
        <button class="btn-primary btn-block" id="fig-enregistrer" hidden>✅ Enregistrer la figure</button></div>`;
      const stage = corps.querySelector(".fig-stage");
      const maj = () => {
        stage.querySelectorAll(".fig-box").forEach(b => b.remove());
        placees.forEach((p, n) => {
          const b = document.createElement("div");
          b.className = "fig-box";
          Object.assign(b.style, { left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.w * 100}%`, height: `${p.h * 100}%` });
          b.textContent = n + 1;
          stage.appendChild(b);
        });
        const fini = i >= textes.length;
        corps.querySelector("#fig-consigne").innerHTML = fini
          ? `C'est fait : ${placees.length} légende${placees.length > 1 ? "s" : ""} placée${placees.length > 1 ? "s" : ""}.`
          : `Encadre « <b>${esc(textes[i])}</b> » sur la figure <span class="muted">(${i + 1}/${textes.length})</span>`;
        corps.querySelector("#fig-enregistrer").hidden = !(fini && placees.length >= 2);
        corps.querySelector("#fig-sauter").hidden = fini;
      };
      zoneDeSelection(stage, rect => {
        if (i >= textes.length) return;
        placees.push({ texte: textes[i], ...rect });
        historique.push("place");
        i += 1;
        maj();
      });
      corps.querySelector("#fig-sauter").addEventListener("click", () => { historique.push("saute"); i += 1; maj(); });
      corps.querySelector("#fig-annuler").addEventListener("click", () => {
        const dernier = historique.pop();
        if (!dernier) return;
        if (dernier === "place") placees.pop();
        i -= 1;
        maj();
      });
      corps.querySelector("#fig-enregistrer").addEventListener("click", async e => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = "Enregistrement…";
        try {
          await enregistrerFigure({ coursId, titre: figure.titre, type: figure.type || "schema", image: recadree, legendes: placees });
          resolve("ok");
        } catch (err) {
          console.error(err);
          btn.textContent = "❌ Échec, réessayer";
          btn.disabled = false;
        }
      });
      maj();
    };

    etapeSource();
  });
}

function afficherBilanFigures(coursId, resultats, pages) {
  const ok = resultats.filter(r => r.ok).length;
  const corps = ouvrirLibre(`<div class="game-head hdr-figure"><div class="modal-kicker">🗺️ Schémas & cartes</div><h3>${ok} schéma${ok > 1 ? "s" : ""} vierge${ok > 1 ? "s" : ""} prêt${ok > 1 ? "s" : ""}</h3></div>
    <div class="game-body" id="fig-bilan"><p class="muted">Vérifie que chaque légende est bien cachée par une case. Sinon, refais-la à la main.</p></div>`);
  const zone = corps.querySelector("#fig-bilan");
  resultats.forEach(r => {
    const bloc = document.createElement("div");
    bloc.className = "fig-bilan-item";
    bloc.innerHTML = `<div class="gram-card-title">${r.ok ? "✅" : "⚠️"} ${esc(r.figure.titre)}</div>${r.ok ? "" : `<p class="muted">L'IA n'a pas réussi à placer les cases automatiquement.</p>`}`;
    if (r.ok) bloc.appendChild(avecZoom(apercuFigure(r.prete)));
    const nav = document.createElement("div");
    nav.className = "fig-nav";
    nav.innerHTML = `${r.ok ? `<button class="btn-ghost-small fig-tourner-bilan">↻ Tourner</button>` : ""}<button class="btn-ghost-small fig-main-bilan">✋ ${r.ok ? "Refaire à la main" : "Faire à la main"}</button>`;
    nav.querySelector(".fig-tourner-bilan")?.addEventListener("click", async e => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        r.prete = await tournerFigure(r.prete);
        await updateDoc(doc(db, "figuresRevisions", r.id), { image: r.prete.image, legendes: r.prete.legendes });
        afficherBilanFigures(coursId, resultats, pages);
      } catch (err) {
        console.error(err);
        btn.textContent = "❌ Échec";
      }
    });
    nav.querySelector(".fig-main-bilan").addEventListener("click", async () => {
      if (r.ok) await supprimerFigure(r.id);
      await assistantFigure({ coursId, figure: { ...r.figure }, pages, manuel: true });
      afficherBilanFigures(coursId, resultats.filter(x => x !== r), pages);
    });
    bloc.appendChild(nav);
    zone.appendChild(bloc);
  });
  const fin = document.createElement("button");
  fin.className = "btn-primary btn-block";
  fin.textContent = "C'est bon !";
  fin.addEventListener("click", () => document.getElementById("modal-libre-close").click());
  zone.appendChild(fin);
}

// Un schéma ou une carte à apprendre, à la demande : cours → page → nom → tout de suite (IA) ou plus tard (préparé hors appli).
function demanderFigure() {
  const histoire = matiereCourante === "histoire";
  const coursListe = Object.entries(coursById).filter(([, c]) => c.statut !== "attente")
    .sort(([, a], [, b]) => (b.dateAjout || "").localeCompare(a.dateAjout || ""))
    .map(([id, c]) => ({ coursId: id, titre: c.titre || "Cours" }));
  const corps = ouvrirLibre(`<div class="game-head hdr-figure"><div class="modal-kicker">🗺️ Schémas${histoire ? " & cartes" : ""}</div><h3>Apprendre un schéma${histoire ? " ou une carte" : ""}</h3></div>
    <div class="game-body" id="fig-ajout-corps"></div>`);
  const zone = corps.querySelector("#fig-ajout-corps");
  const fermer = () => document.getElementById("modal-libre-close").click();

  const etapeCours = () => {
    zone.innerHTML = `<p class="muted">Dans quel cours ?</p>
      ${coursListe.map((c, i) => `<button class="cours-choix" data-c="${i}"><span>${esc(c.titre)}</span><span>→</span></button>`).join("")}
      <button class="cours-choix" id="fig-libre"><span>📷 Une autre figure (photo)</span><span class="muted">tu tapes les légendes toi-même</span></button>`;
    zone.querySelectorAll("[data-c]").forEach(b => b.addEventListener("click", () => etapePage(coursListe[Number(b.dataset.c)])));
    zone.querySelector("#fig-libre").addEventListener("click", async () => {
      await assistantFigure({ coursId: null, figure: {}, pages: [] });
      fermer();
      loadNotions();
    });
  };

  const etapePage = async c => {
    zone.innerHTML = `<div class="loading-exos">Chargement des pages du cours…</div>`;
    let pages = [];
    try { pages = await chargerPagesCours(c.coursId); } catch (err) { console.error(err); }
    if (!pages.length) {
      zone.innerHTML = `<p class="muted">Les pages de ce cours n'ont pas été gardées.</p>
        <button class="btn-primary btn-block" id="fig-donner">📎 Donner les pages de ce cours (photo ou PDF)</button>
        <p class="muted">Une seule fois : elles sont gardées pour la suite.</p>
        <button class="btn-ghost-small" id="fig-retour">← Retour</button>`;
      zone.querySelector("#fig-retour").addEventListener("click", etapeCours);
      zone.querySelector("#fig-donner").addEventListener("click", async e => {
        const b = e.currentTarget;
        const sources = await choisirFichiersCours();
        if (!sources.length) return;
        b.disabled = true;
        b.textContent = "Lecture et sauvegarde des pages…";
        try {
          await enregistrerPagesCours(c.coursId, await pagesDepuisSources(sources));
          etapePage(c);
        } catch (err) {
          console.error(err);
          b.disabled = false;
          b.textContent = "❌ Échec, réessayer";
        }
      });
      return;
    }
    zone.innerHTML = `<p class="muted">Sur quelle page est ${histoire ? "le schéma ou la carte" : "le schéma"} ?</p>
      <div class="fig-pages">${pages.map((p, i) => `<button class="fig-page" data-p="${i}"><img src="${p}" alt=""><span>Page ${i + 1}</span></button>`).join("")}</div>
      <button class="btn-ghost-small" id="fig-retour">← Retour</button>`;
    zone.querySelector("#fig-retour").addEventListener("click", etapeCours);
    zone.querySelectorAll("[data-p]").forEach(b => b.addEventListener("click", () => etapeNom(c, pages, Number(b.dataset.p))));
  };

  const etapeNom = (c, pages, i) => {
    zone.innerHTML = `<img src="${pages[i]}" class="fig-page-choisie" alt="">
      <label class="fig-label">Son nom<input type="text" id="fig-nom" maxlength="80" placeholder="${histoire ? "ex : L'empire de Charlemagne" : "ex : Le cœur"}"></label>
      ${histoire ? `<div class="fig-nav"><label><input type="radio" name="fig-type" value="schema" checked> Schéma</label><label><input type="radio" name="fig-type" value="carte"> Carte</label></div>` : ""}
      <div class="envoi-modes">
        <button class="btn-primary envoi-mode" id="fig-vite"><b>⚡ Tout de suite</b><span>prêt dans 1 minute</span></button>
        <button class="btn-primary envoi-mode envoi-attente" id="fig-attente"><b>🕓 Je peux attendre</b><span>prêt un peu plus tard</span></button>
      </div>
      <div class="fig-nav"><button class="btn-ghost-small" id="fig-retour">← Autre page</button><button class="btn-ghost-small" id="fig-main">✋ Le faire à la main</button></div>
      <div class="panel-info" id="fig-statut" hidden></div>`;
    const lire = () => ({
      titre: zone.querySelector("#fig-nom").value.trim() || (histoire ? "Carte ou schéma" : "Schéma"),
      type: zone.querySelector("input[name=fig-type]:checked")?.value || "schema",
      page: i + 1,
    });
    const statut = zone.querySelector("#fig-statut");
    const vite = zone.querySelector("#fig-vite"), attente = zone.querySelector("#fig-attente");
    zone.querySelector("#fig-retour").addEventListener("click", () => etapePage(c));
    vite.addEventListener("click", async () => {
      const f = lire();
      vite.disabled = attente.disabled = true;
      statut.hidden = false;
      statut.textContent = "✂️ Je prépare le schéma vierge…";
      try {
        const prete = await preparerFigureAuto(pages[i], f);
        const id = await enregistrerFigure({ coursId: c.coursId, ...prete });
        afficherBilanFigures(c.coursId, [{ ok: true, id, figure: f, page: pages[i], prete }], pages);
      } catch (err) {
        console.error(err);
        afficherBilanFigures(c.coursId, [{ ok: false, figure: f, page: pages[i] }], pages);
      }
      loadNotions();
    });
    attente.addEventListener("click", async () => {
      const f = lire();
      vite.disabled = attente.disabled = true;
      statut.hidden = false;
      try {
        await addDoc(collection(db, "figuresRevisions"), {
          eleve: eleveCourant, matiere: matiereCourante, coursId: c.coursId,
          titre: f.titre, type: f.type, page: f.page, statut: "attente",
          image: "", legendes: [], dateAjout: new Date().toISOString(),
        });
        statut.textContent = `🕓 C'est noté ! « ${f.titre} » est en préparation.`;
        loadNotions();
      } catch (err) {
        console.error(err);
        statut.textContent = "❌ Oups, la demande n'a pas été enregistrée. Réessaie.";
        vite.disabled = attente.disabled = false;
      }
    });
    zone.querySelector("#fig-main").addEventListener("click", async () => {
      await assistantFigure({ coursId: c.coursId, figure: lire(), pages, manuel: true });
      fermer();
      loadNotions();
    });
  };

  etapeCours();
}

// Exercice : replacer chaque étiquette sur sa case numérotée.
function renderFigureExercice(fig, { onAnswered } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "fig-exo";
  const legendes = fig.legendes || [];
  const ordre = melanger(legendes.map((l, i) => i));
  wrap.innerHTML = `<p class="muted">Clique sur une étiquette, puis sur la case où elle va. Clique sur une case remplie pour la vider.</p>
    <div class="fig-stage fig-jeu"><img src="${fig.image}" class="fig-img" alt="" draggable="false"></div>
    <div class="fig-etiquettes"></div>
    <button class="btn-primary btn-block fig-valider" disabled>Valider</button>
    <div class="fig-resultat"></div>`;
  const stage = wrap.querySelector(".fig-stage");
  const etiq = wrap.querySelector(".fig-etiquettes");
  wrap.insertBefore(avecZoom(stage), etiq);
  const valider = wrap.querySelector(".fig-valider");
  const placement = new Array(legendes.length).fill(null);
  let selection = null;
  let fini = false;
  const masques = legendes.map((l, i) => {
    const m = document.createElement("button");
    m.className = "fig-masque";
    Object.assign(m.style, { left: `${l.x * 100}%`, top: `${l.y * 100}%`, width: `${l.w * 100}%`, height: `${l.h * 100}%` });
    m.addEventListener("click", () => {
      if (fini) return;
      if (selection !== null) {
        const ancien = placement.indexOf(selection);
        if (ancien >= 0) placement[ancien] = null;
        placement[i] = selection;
        selection = null;
      } else {
        placement[i] = null;
      }
      maj();
    });
    stage.appendChild(m);
    return m;
  });
  const maj = () => {
    masques.forEach((m, i) => {
      const p = placement[i];
      m.classList.toggle("rempli", p !== null);
      m.innerHTML = p !== null ? `<span class="fig-txt">${esc(legendes[p].texte)}</span>` : `<span class="fig-num">${i + 1}</span>`;
    });
    etiq.innerHTML = "";
    ordre.forEach(idx => {
      const c = document.createElement("button");
      c.className = `mot-chip${selection === idx ? " choisi" : ""}`;
      c.textContent = legendes[idx].texte;
      c.disabled = fini || placement.includes(idx);
      c.addEventListener("click", () => { selection = selection === idx ? null : idx; maj(); });
      etiq.appendChild(c);
    });
    valider.disabled = fini || placement.some(p => p === null);
  };
  valider.addEventListener("click", () => {
    fini = true;
    maj();
    let bonnes = 0;
    masques.forEach((m, i) => {
      const ok = normaliser(legendes[placement[i]].texte) === normaliser(legendes[i].texte);
      if (ok) bonnes += 1;
      m.classList.add(ok ? "ok" : "ko");
      m.innerHTML = `<span class="fig-txt">${esc(legendes[i].texte)}</span>`;
    });
    const total = legendes.length;
    const reussi = bonnes / total >= 0.8;
    wrap.querySelector(".fig-resultat").innerHTML = `<div class="today-score${reussi ? "" : " score-low"}">${bonnes === total ? "🏆" : reussi ? "🎉" : "💪"} ${bonnes}/${total} légendes bien placées</div>`;
    onAnswered?.(reussi, bonnes, total);
  });
  maj();
  return wrap;
}

function ouvrirFigure(fig) {
  const corps = ouvrirLibre(`<div class="game-head hdr-figure"><div class="modal-kicker">🗺️ ${fig.type === "carte" ? "Carte" : "Schéma"} à compléter</div><h3>${esc(fig.titre)}</h3></div><div class="game-body"></div>`);
  const body = corps.querySelector(".game-body");
  const lancer = () => {
    body.innerHTML = "";
    body.appendChild(renderFigureExercice(fig, {
      onAnswered: (ok, bonnes, total) => {
        enregistrerReponse(`fig_${fig.id}`, ok, { source: "schema", question: fig.titre, reponse: `${bonnes}/${total}` });
        const actions = document.createElement("div");
        actions.className = "fig-nav";
        actions.innerHTML = `<button class="btn-primary btn-small">🔁 Recommencer</button>${fig.statut === "a_refaire"
          ? `<span class="pill pill-attente">🕓 Confié : il sera refait bientôt</span>`
          : `<button class="btn-ghost-small fig-confier">🕓 Cases mal placées ? Me le confier</button>`}<button class="btn-ghost-small fig-suppr">🗑️ Supprimer cette figure</button>`;
        actions.querySelector(".btn-primary").addEventListener("click", lancer);
        actions.querySelector(".fig-confier")?.addEventListener("click", async e => {
          const b = e.currentTarget;
          b.disabled = true;
          try {
            await updateDoc(doc(db, "figuresRevisions", fig.id), { statut: "a_refaire", demandeLe: new Date().toISOString() });
            fig.statut = "a_refaire";
            b.textContent = "✅ Confié : il sera refait bientôt";
          } catch (err) {
            console.error(err);
            b.disabled = false;
            b.textContent = "❌ Échec, réessayer";
          }
        });
        const suppr = actions.querySelector(".fig-suppr");
        suppr.addEventListener("click", async () => {
          if (!suppr.dataset.confirme) { suppr.dataset.confirme = "1"; suppr.textContent = "Confirmer la suppression ?"; return; }
          try {
            await deleteDoc(doc(db, "figuresRevisions", fig.id));
            await deleteDoc(doc(db, "progressionAnglais", `fig_${fig.id}`));
            document.getElementById("modal-libre-close").click();
          } catch (err) {
            console.error(err);
            suppr.textContent = "❌ Suppression impossible";
          }
        });
        body.appendChild(actions);
      },
    }));
  };
  lancer();
}

async function ajouterSectionFigures(el) {
  if (!MATIERES_FIGURES.includes(matiereCourante)) return;
  const snap = await getDocs(query(collection(db, "figuresRevisions"), where("eleve", "==", eleveCourant)));
  const figs = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(f => f.matiere === matiereCourante);
  figuresById = Object.fromEntries(figs.map(f => [f.id, f]));
  el.querySelector("#fig-section")?.remove();
  el.insertAdjacentHTML("beforeend", `<div id="fig-section"><h3 class="section-title">🗺️ Schémas${matiereCourante === "histoire" ? " & cartes" : ""} <span>${figs.length}</span></h3>
    <div class="fig-grid">${figs.map(f => {
      if (f.statut === "attente") {
        return `<div class="fig-carte fig-carte-attente"><div class="fig-attente-visuel">⏳</div>
          <div class="fig-carte-info"><span class="pill pill-attente">en préparation</span><div class="gram-card-title">${esc(f.titre)}</div></div></div>`;
      }
      const n = notionsById[`fig_${f.id}`];
      const st = statutNiveau(n?.niveau || 0);
      return `<button class="fig-carte ${st.cls}" data-fig="${esc(f.id)}"><img src="${f.image}" alt="">
        <div class="fig-carte-info"><span class="pill ${st.cls}">${st.label}</span>${n ? marqueDerniere(n) : ""}
        ${f.statut === "a_refaire" ? `<span class="pill pill-attente">🕓 à refaire</span>` : ""}<div class="gram-card-title">${esc(f.titre)}</div><div class="gram-card-cours">${(f.legendes || []).length} légendes</div>${barreNiveau(n?.niveau || 0)}</div></button>`;
    }).join("")}
    <button class="fig-ajout" id="fig-ajout">➕ Apprendre un schéma${matiereCourante === "histoire" ? " ou une carte" : ""}</button></div></div>`);
  el.querySelectorAll("[data-fig]").forEach(b => b.addEventListener("click", () => ouvrirFigure(figuresById[b.dataset.fig])));
  el.querySelector("#fig-ajout").addEventListener("click", demanderFigure);
}

async function afficherFigureDuJour() {
  const bloc = document.getElementById("block-figure");
  bloc.hidden = true;
  if (!MATIERES_FIGURES.includes(matiereCourante)) return;
  const contexte = idSeanceDuJour();
  try {
    const snap = await getDocs(query(collection(db, "progressionAnglais"), where("eleve", "==", eleveCourant)));
    const dues = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(n => n.type === "figure" && n.matiere === matiereCourante && (n.prochaineDate || "") <= todayISO())
      .sort((a, b) => (b.dernierResultat === false) - (a.dernierResultat === false) || (a.niveau || 0) - (b.niveau || 0));
    if (!dues.length || contexte !== idSeanceDuJour()) return;
    const figSnap = await getDoc(doc(db, "figuresRevisions", dues[0].figureId));
    if (!figSnap.exists() || contexte !== idSeanceDuJour()) return;
    const fig = { id: figSnap.id, ...figSnap.data() };
    bloc.hidden = false;
    const zone = document.getElementById("figure-du-jour");
    zone.innerHTML = `<div class="gram-card-title fig-titre-jour">${esc(fig.titre)}</div>`;
    zone.appendChild(renderFigureExercice(fig, {
      onAnswered: (ok, b, t) => enregistrerReponse(`fig_${fig.id}`, ok, { source: "schema", question: fig.titre, reponse: `${b}/${t}` }),
    }));
  } catch (err) {
    console.error("Figure du jour", err);
  }
}

window.__appPrete = true;
