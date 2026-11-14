// ============================================================
// English Time — outil d'anglais quotidien pour Lucie (Firebase modular SDK v10, pas de build step)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, updateDoc, getDocs, query, where, addDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
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
document.getElementById("btn-toggle-password").addEventListener("click", () => {
  const input = document.getElementById("login-password");
  const btn = document.getElementById("btn-toggle-password");
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  btn.textContent = showing ? "👁" : "🙈";
  btn.title = showing ? "Afficher le mot de passe" : "Masquer le mot de passe";
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.hidden = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    errorEl.textContent = "Email ou mot de passe incorrect.";
    errorEl.hidden = false;
  }
});

document.getElementById("btn-forgot-password").addEventListener("click", async () => {
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
  } catch {
    okEl.textContent = "Si ce compte existe, un email vient d'être envoyé.";
    okEl.hidden = false;
  }
});

document.getElementById("btn-logout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  document.getElementById("screen-login").hidden = !!user;
  document.getElementById("screen-app").hidden = !user;
  if (user) {
    loadToday();
    loadNotions();
  }
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
    if (btn.dataset.tab === "chansons") loadChansons();
    if (btn.dataset.tab === "entrainer" && !Object.keys(notionsById).length) loadNotions();
    if (btn.dataset.tab === "today" && document.getElementById("today-content").hidden) loadToday();
  });
});

// ------------------------------------------------------------
// AUJOURD'HUI — exercices du jour
// ------------------------------------------------------------
let notionsById = {};
let score = { bonnes: 0, total: 0 };

async function loadToday() {
  document.getElementById("today-loading").hidden = false;
  document.getElementById("today-empty").hidden = true;
  document.getElementById("today-content").hidden = true;

  try {
    const snap = await getDoc(doc(db, "exercicesAnglais", todayISO()));
    let data;
    if (snap.exists() && snap.data().version === 3) {
      data = snap.data();
    } else {
      const genererExercicesDuJour = httpsCallable(functions, "genererExercicesDuJour", { timeout: 180000 });
      data = await genererExercicesDuJour({}).then(r => r.data);
    }
    renderToday(data);
  } catch (err) {
    document.getElementById("today-loading").hidden = true;
    document.getElementById("today-empty").hidden = false;
    document.getElementById("today-empty").textContent =
      err?.message?.includes("Aucune notion")
        ? "Pas encore de notion à réviser aujourd'hui — va dans + Un cours pour ajouter ton premier cours 📸"
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
  if (data.comprehensionEcrite?.texte) {
    ceBlock.hidden = false;
    texteEcoute = data.comprehensionEcrite.texte;
    document.getElementById("ce-texte").innerHTML = motsCliquables(texteEcoute);
    document.getElementById("ce-texte").hidden = true;
    document.getElementById("btn-show-text").hidden = false;
    renderTodayList("ce-questions", data.comprehensionEcrite.questions || [], false);
  } else {
    ceBlock.hidden = true;
  }
  renderTodayList("vocab-questions", data.vocabulaire || [], true);
  renderTodayList("gram-questions", data.grammaire || [], true);
}

// ÉCOUTE : synthèse vocale du navigateur, voix anglaise (gratuit, hors ligne selon l'appareil).
let texteEcoute = "";
let vitesseEcoute = 0.95;

function voixAnglaise() {
  const voix = speechSynthesis.getVoices();
  return voix.find(v => /en-GB/i.test(v.lang) && /google|natural|online/i.test(v.name))
    || voix.find(v => /en-GB/i.test(v.lang))
    || voix.find(v => /^en/i.test(v.lang));
}

function majBoutonEcoute(enCours) {
  document.getElementById("btn-play").textContent = enCours ? "❚❚" : "▶";
  document.getElementById("audio-title").textContent = enCours ? "Lecture en cours…" : "Écouter le texte";
}

document.getElementById("btn-play").addEventListener("click", () => {
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
  const v = voixAnglaise();
  if (v) u.voice = v;
  u.lang = v?.lang || "en-GB";
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

document.getElementById("btn-show-text").addEventListener("click", (e) => {
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
  try {
    await addDoc(collection(db, "seancesAnglais"), { type: "jour", date: todayISO(), ...resultat });
    await updateDoc(doc(db, "exercicesAnglais", todayISO()), { terminee: true, resultat });
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
    <div class="bilan-actions">
      <button class="btn-primary" id="btn-nouvelle-seance">🔁 Nouvelle séance${resultat.erreurs.length ? " (on reprend tes erreurs)" : ""}</button>
    </div>`;
  s.querySelectorAll("[data-revoir]").forEach(b => b.addEventListener("click", () => openNotionModal(b.dataset.revoir)));
  s.querySelector("#btn-nouvelle-seance").addEventListener("click", nouvelleSeance);
  s.scrollIntoView({ behavior: "smooth", block: "center" });
}

document.getElementById("btn-autre-seance").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = "Préparation… ✍️";
  try {
    const genererExercicesDuJour = httpsCallable(functions, "genererExercicesDuJour", { timeout: 180000 });
    const data = await genererExercicesDuJour({ regenerer: true }).then(r => r.data);
    renderToday(data);
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
    const genererExercicesDuJour = httpsCallable(functions, "genererExercicesDuJour", { timeout: 180000 });
    const data = await genererExercicesDuJour({ regenerer: true }).then(r => r.data);
    renderToday(data);
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    btn.textContent = "❌ Échec, réessayer";
  }
}

function normaliser(s) {
  return String(s || "").toLowerCase().replace(/[’`]/g, "'").replace(/[.,!?;:"]/g, "").replace(/\s+/g, " ").trim();
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
    const cible = document.createElement("div");
    cible.className = "ordre-cible";
    const reserve = document.createElement("div");
    reserve.className = "ordre-reserve";
    const choisis = [];
    const majCible = () => {
      cible.textContent = choisis.length ? choisis.map(c => c.mot).join(" ") : "Clique sur les mots dans le bon ordre…";
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
      const correct = normaliser(choisis.map(c => c.mot).join(" ")) === normaliser(ex.reponse);
      ok.disabled = true; effacer.disabled = true;
      cible.classList.add(correct ? "correct" : "incorrect");
      finish(correct, ex.reponse, choisis.map(c => c.mot).join(" "));
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
  addDoc(collection(db, "reponsesAnglais"), {
    at: new Date().toISOString(), date: todayISO(), notionId, correct: !!correct, source,
    question: String(question).slice(0, 300), reponse: String(reponse ?? "").slice(0, 200),
  }).catch(err => console.error("Journal réponse", err));
}

async function enregistrerReponse(notionId, correct, { pas = 1, source = "seance", question = "", reponse = "", journal = true } = {}) {
  if (journal) journaliser({ notionId, correct, source, question, reponse });
  try {
    const ref = doc(db, "progressionAnglais", notionId);
    const snap = await getDoc(ref);
    if (!snap.exists()) { console.warn("Notion introuvable pour la réponse", notionId); return; }
    const data = snap.data();
    let niveau = data.niveau || 0;
    niveau = correct ? Math.min(niveau + pas, 5) : Math.max(niveau - 1, 0);
    const d = new Date();
    d.setDate(d.getDate() + NIVEAUX_JOURS[niveau]);
    await updateDoc(ref, {
      niveau, dernierResultat: correct,
      prochaineDate: d.toISOString().slice(0, 10),
      dernierVu: todayISO(),
    });
  } catch (err) {
    console.error("Erreur enregistrement réponse", err);
  }
}

// ------------------------------------------------------------
// AJOUTER UN COURS
// ------------------------------------------------------------
let photosEnAttente = [];

document.getElementById("photo-input").addEventListener("change", async (e) => {
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
  document.getElementById("btn-envoyer-cours").disabled = photosEnAttente.length === 0;
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

document.getElementById("btn-envoyer-cours").addEventListener("click", async () => {
  const statusEl = document.getElementById("add-status");
  const btn = document.getElementById("btn-envoyer-cours");
  btn.disabled = true;
  statusEl.hidden = false;
  statusEl.textContent = "La prof IA regarde ton cours… 🧐";
  try {
    const extraireCoursAnglais = httpsCallable(functions, "extraireCoursAnglais", { timeout: 900000 });
    const result = await extraireCoursAnglais({ images: photosEnAttente }).then(r => r.data);
    statusEl.textContent = `✅ Cours ajouté : ${result.titre} (${(result.vocabulaire || []).length} mots, ${(result.grammaire || []).length} règle(s) de grammaire).`;
    photosEnAttente = [];
    document.getElementById("photo-preview").innerHTML = "";
    document.getElementById("photo-input").value = "";
    loadNotions();
    loadToday();
  } catch (err) {
    statusEl.textContent = "❌ Oups, la prof IA n'a pas réussi à lire ce cours. Réessaie avec une photo plus nette.";
    console.error(err);
  } finally {
    btn.disabled = photosEnAttente.length === 0;
  }
});

// ------------------------------------------------------------
// MES NOTIONS
// ------------------------------------------------------------
let coursById = {};

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
  const el = document.getElementById("notions-list");
  const [progSnap, coursSnap, seancesSnap, reponsesSnap] = await Promise.all([
    getDocs(collection(db, "progressionAnglais")),
    getDocs(collection(db, "coursAnglais")),
    getDocs(collection(db, "seancesAnglais")),
    getDocs(collection(db, "reponsesAnglais")),
  ]);
  const reponses = reponsesSnap.docs.map(d => d.data());
  const seances = seancesSnap.docs.map(d => d.data()).sort((a, b) => (b.finieLe || "").localeCompare(a.finieLe || ""));
  coursById = {};
  coursSnap.forEach(d => { coursById[d.id] = d.data(); });
  notionsById = {};
  progSnap.forEach(d => { notionsById[d.id] = { id: d.id, ...d.data() }; });
  const rows = Object.values(notionsById).sort((a, b) => (a.niveau || 0) - (b.niveau || 0) || a.label.localeCompare(b.label));

  if (!rows.length) {
    el.innerHTML = `<div class="panel-info">Pas encore de notion — ajoute un cours pour commencer 📸</div>`;
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
    ${htmlBadges(calculerMotivation({ reponses, seances, rows }))}
    <h3 class="section-title">📐 Grammaire <span>${grammaire.length}</span></h3>
    <div class="gram-grid">${grammaire.map(n => {
      const st = statutNiveau(n.niveau || 0);
      return `<button class="gram-card ${st.cls}" data-id="${esc(n.id)}">
        <span class="pill ${st.cls}">${st.label}</span>${marqueDerniere(n)}
        <div class="gram-card-title">${esc(n.label)}</div>
        <div class="gram-card-cours">${esc(coursById[n.coursId]?.titre || "")}</div>
        ${barreNiveau(n.niveau || 0)}
      </button>`;
    }).join("")}</div>
    <h3 class="section-title">🔤 Vocabulaire <span>${vocab.length}</span></h3>
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
          <div class="theme-actions">
            <button class="btn-primary btn-small" data-flash="${i}">🃏 Flashcards</button>
            <button class="btn-speed btn-small" data-speed="${i}">⚡ Jeu de vitesse</button>
          </div>
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
  el.querySelectorAll("[data-flash]").forEach(b => b.addEventListener("click", () => lancerFlashcards(themes[b.dataset.flash])));
  el.querySelectorAll("[data-speed]").forEach(b => b.addEventListener("click", () => lancerJeuVitesse(themes[b.dataset.speed], vocab)));
}

function tradDe(n) {
  return coursById[n.coursId]?.vocabulaire?.find(x => x.mot === n.label)?.traduction || "";
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
document.getElementById("modal-libre-close").addEventListener("click", () => {
  document.getElementById("modal-libre").hidden = true;
  clearInterval(jeuTimer);
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
    const cle = `record-vitesse-${theme}`;
    let record = 0;
    try { record = Number(localStorage.getItem(cle) || 0); if (score > record) localStorage.setItem(cle, String(score)); } catch {}
    addDoc(collection(db, "seancesAnglais"), {
      type: "vitesse", theme, date: todayISO(), score, total: score + erreurs, erreursNb: erreurs, finieLe: new Date().toISOString(),
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
  const snap = await getDocs(collection(db, "chansonsAnglais"));
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
  (c.annotations || []).forEach(a => { (parLigne[a.ligne] ||= []).push(a); });
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
      await ficheChansonAnglais({ id: c.id, youtubeId, ...(parolesChangees ? { paroles } : {}) });
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

document.getElementById("btn-add-song").addEventListener("click", async () => {
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
    await ficheChansonAnglais({ titre, artiste, youtubeId, paroles: document.getElementById("song-paroles").value });
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
    const snap = await getDocs(query(collection(db, "reponsesAnglais"), where("notionId", "==", notionId)));
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

document.getElementById("btn-entrainer").addEventListener("click", async () => {
  const btn = document.getElementById("btn-entrainer");
  const zone = document.getElementById("modal-exos");
  const notionId = modalNotionId;
  btn.disabled = true;
  zone.innerHTML = `<div class="loading-exos">✍️ La prof IA prépare tes exercices…</div>`;
  try {
    const exercicesNotionAnglais = httpsCallable(functions, "exercicesNotionAnglais", { timeout: 120000 });
    const { exercices } = await exercicesNotionAnglais({ notionId }).then(r => r.data);
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

document.getElementById("modal-close").addEventListener("click", () => {
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
  try { vus = JSON.parse(localStorage.getItem("badges-vus") || "null"); } catch {}
  try { localStorage.setItem("badges-vus", JSON.stringify(obtenus)); } catch {}
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
function phrasesEntrainement(n = 8) {
  const pool = [];
  Object.values(notionsById).forEach(no => {
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

function comparerMots(attendu, donne) {
  const restant = motsDe(donne);
  const resultat = motsDe(attendu).map(m => {
    const i = restant.indexOf(m);
    if (i >= 0) { restant.splice(i, 1); return { m, ok: true }; }
    return { m, ok: false };
  });
  return { resultat, taux: resultat.length ? resultat.filter(x => x.ok).length / resultat.length : 0 };
}

function dire(texte, rate = 0.95) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texte);
  const v = voixAnglaise();
  if (v) u.voice = v;
  u.lang = v?.lang || "en-GB";
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
document.getElementById("btn-pron").addEventListener("click", lancerPrononciation);

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
document.getElementById("btn-dictee").addEventListener("click", lancerDictee);

function lancerDictee() {
  const phrases = phrasesEntrainement(6);
  const corps = ouvrirLibre(`<div class="game-head hdr-dictee"><div class="modal-kicker">✍️ Dictée</div><h3 id="di-compteur"></h3></div><div class="game-body"></div>`);
  if (!phrases.length) { corps.querySelector(".game-body").innerHTML = `<div class="panel-info">Ajoute d'abord un cours 📸</div>`; return; }
  let i = 0, bonnes = 0;
  const afficher = () => {
    if (i >= phrases.length) return finEntrainement(corps, "✍️ Phrases sans faute", bonnes, phrases.length, lancerDictee);
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
document.getElementById("btn-controle").addEventListener("click", async () => {
  if (!Object.keys(coursById).length) await loadNotions();
  const cours = Object.entries(coursById).sort((a, b) => (b[1].dateAjout || "").localeCompare(a[1].dateAjout || ""));
  const corps = ouvrirLibre(`<div class="game-head hdr-controle"><div class="modal-kicker">📝 Contrôle blanc</div><h3>Quel cours réviser ?</h3></div>
    <div class="game-body">${cours.length ? cours.map(([id, c]) => `<button class="cours-choix" data-cours="${esc(id)}"><span>${esc(c.titre)}</span><span class="muted">${(c.vocabulaire || []).length} mots · ${(c.grammaire || []).length} règles</span></button>`).join("") : `<div class="panel-info">Ajoute d'abord un cours 📸</div>`}</div>`);
  corps.querySelectorAll("[data-cours]").forEach(b => b.addEventListener("click", () => lancerControle(b.dataset.cours)));
});

async function lancerControle(coursId) {
  const corps = ouvrirLibre(`<div class="game-head hdr-controle"><div class="modal-kicker">📝 Contrôle blanc</div><h3>${esc(coursById[coursId]?.titre || "")}</h3></div>
    <div class="game-body"><div class="loading-exos">✍️ La prof IA prépare ton contrôle… (environ une minute)</div></div>`);
  try {
    const controleCoursAnglais = httpsCallable(functions, "controleCoursAnglais", { timeout: 240000 });
    const { exercices } = await controleCoursAnglais({ coursId }).then(r => r.data);
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

// RÉCAP PARENT (aperçu)
document.getElementById("btn-recap-test").addEventListener("click", async (e) => {
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
