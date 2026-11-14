// ============================================================
// English Time — outil d'anglais quotidien pour Lucie (Firebase modular SDK v10, pas de build step)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, updateDoc, getDocs, query, where
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
  score = { bonnes: 0, total: 0, repondues: 0 };

  const ceBlock = document.getElementById("block-comprehension");
  if (data.comprehensionEcrite?.texte) {
    ceBlock.hidden = false;
    texteEcoute = data.comprehensionEcrite.texte;
    document.getElementById("ce-texte").textContent = texteEcoute;
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
      onAnswered: (correct) => {
        score.repondues += 1;
        if (correct) score.bonnes += 1;
        if (suiviNotion && item.notionId) enregistrerReponse(item.notionId, correct);
        if (score.repondues === score.total) {
          const s = document.getElementById("today-score");
          s.hidden = false;
          s.textContent = `🎉 Séance terminée : ${score.bonnes}/${score.total} bonnes réponses !`;
        }
      },
    }));
  });
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
  const finish = (correct, bonneReponseTexte) => {
    if (done) return;
    done = true;
    card.classList.add(correct ? "is-correct" : "is-incorrect");
    const expl = document.createElement("div");
    expl.className = "exo-explication";
    const solution = !correct && bonneReponseTexte ? `Réponse : « ${bonneReponseTexte} ». ` : "";
    expl.textContent = `${correct ? "✅ Bravo ! " : "💡 "}${solution}${ex.explication || ""}`;
    card.appendChild(expl);
    onAnswered?.(correct);
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
      finish(correct, (ex.reponses || [])[0]);
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
      finish(correct, ex.reponse);
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
        finish(correct, null);
      });
      list.appendChild(b);
    });
    card.appendChild(list);
  }
  return card;
}

async function enregistrerReponse(notionId, correct, pas = 1) {
  try {
    const ref = doc(db, "progressionAnglais", notionId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
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
  const [progSnap, coursSnap] = await Promise.all([
    getDocs(collection(db, "progressionAnglais")),
    getDocs(collection(db, "coursAnglais")),
  ]);
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
    <h3 class="section-title">📐 Grammaire <span>${grammaire.length}</span></h3>
    <div class="gram-grid">${grammaire.map(n => {
      const st = statutNiveau(n.niveau || 0);
      return `<button class="gram-card ${st.cls}" data-id="${esc(n.id)}">
        <span class="pill ${st.cls}">${st.label}</span>
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
            return `<button class="vocab-chip ${st.cls}" data-id="${esc(n.id)}"><span class="vocab-mot">${esc(n.label)}</span><span class="vocab-trad">${esc(tradDe(n))}</span></button>`;
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
    corps.querySelector(".fc-oui").addEventListener("click", () => { sus += 1; enregistrerReponse(n.id, true); i += 1; afficher(); });
    corps.querySelector(".fc-non").addEventListener("click", () => { enregistrerReponse(n.id, false); i += 1; afficher(); });
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
        if (ok) score += 1; else { erreurs += 1; enregistrerReponse(courant.id, false); }
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

function ouvrirChanson(c) {
  const corps = ouvrirLibre(`<div class="game-head hdr-song"><div class="modal-kicker">🎵 ${esc(c.artiste)}</div><h3>${esc(c.titre)}</h3></div>
    <div class="game-body">
      ${c.youtubeId ? `<div class="video-wrap"><iframe src="https://www.youtube-nocookie.com/embed/${esc(c.youtubeId)}" title="${esc(c.titre)}" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>` : ""}
      <div class="regle-box"><div class="regle-title">De quoi ça parle ?</div>${esc(c.resume)}${c.contexte ? `<p class="song-contexte">${esc(c.contexte)}</p>` : ""}</div>
      <div class="exemples-title">Expressions à retenir</div>
      ${(c.expressions || []).map(x => `<div class="expr-card"><div class="expr-en">${esc(x.expression)}</div><div class="expr-fr">${esc(x.sens)}</div>${x.explication ? `<div class="expr-expl">${esc(x.explication)}</div>` : ""}</div>`).join("")}
      <div class="exemples-title">As-tu bien compris ?</div>
      <div id="song-questions"></div>
    </div>`);
  const zone = corps.querySelector("#song-questions");
  (c.questions || []).forEach(q => zone.appendChild(renderExercise(q)));
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
    await ficheChansonAnglais({ titre, artiste, youtubeId });
    status.textContent = "✅ Chanson ajoutée !";
    ["song-titre", "song-artiste", "song-url"].forEach(id => { document.getElementById(id).value = ""; });
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
  document.getElementById("modal-exos").innerHTML = "";
  const btn = document.getElementById("btn-entrainer");
  btn.hidden = false;
  btn.disabled = false;
  document.getElementById("modal-notion").hidden = false;
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
        onAnswered: (correct) => {
          repondues += 1;
          if (correct) bonnes += 1;
          if (repondues < exercices.length) return;
          const parfait = bonnes === exercices.length;
          const reussi = bonnes >= Math.ceil(exercices.length * 0.75);
          enregistrerReponse(notionId, reussi, parfait ? 2 : 1).then(loadNotions);
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

