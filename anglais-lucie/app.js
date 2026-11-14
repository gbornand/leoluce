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
    if (snap.exists()) {
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
  score = { bonnes: 0, total: 0 };

  const ceBlock = document.getElementById("block-comprehension");
  if (data.comprehensionEcrite?.texte) {
    ceBlock.hidden = false;
    document.getElementById("ce-texte").textContent = data.comprehensionEcrite.texte;
    renderQuestions("ce-questions", (data.comprehensionEcrite.questions || []).map((q, i) => ({
      ...q, notionId: `ce_${i}`, isComprehension: true,
    })));
  } else {
    ceBlock.hidden = true;
  }

  renderQuestions("vocab-questions", data.vocabulaire || []);
  renderQuestions("gram-questions", data.grammaire || []);
}

function renderQuestions(containerId, items) {
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  items.forEach((item) => {
    score.total += 1;
    const card = document.createElement("div");
    card.className = "question-card";

    const label = document.createElement("div");
    label.className = "question-label";
    const span = document.createElement("span");
    span.textContent = item.question;
    label.appendChild(span);
    if (item.notionId && !item.isComprehension) {
      const btnRevoir = document.createElement("button");
      btnRevoir.className = "btn-revoir";
      btnRevoir.textContent = "💡 Revoir";
      btnRevoir.addEventListener("click", () => openNotionModal(item.notionId));
      label.appendChild(btnRevoir);
    }
    card.appendChild(label);

    const choixList = document.createElement("div");
    choixList.className = "choix-list";
    (item.choix || []).forEach((choix, idx) => {
      const btn = document.createElement("button");
      btn.className = "choix-btn";
      btn.textContent = choix;
      btn.addEventListener("click", () => {
        const correct = idx === item.bonneReponse;
        choixList.querySelectorAll(".choix-btn").forEach((b, bi) => {
          b.disabled = true;
          if (bi === item.bonneReponse) b.classList.add("correct");
          else if (bi === idx) b.classList.add("incorrect");
        });
        if (correct) score.bonnes += 1;
        if (item.notionId && !item.isComprehension) enregistrerReponse(item.notionId, correct);
        maybeShowScore();
      });
      choixList.appendChild(btn);
    });
    card.appendChild(choixList);
    el.appendChild(card);
  });
}

function maybeShowScore() {
  const repondues = new Set();
  document.querySelectorAll(".question-card").forEach((card, i) => {
    if (card.querySelector(".choix-btn:disabled")) repondues.add(i);
  });
  if (repondues.size === score.total && score.total > 0) {
    const el = document.getElementById("today-score");
    el.hidden = false;
    el.textContent = `🎉 Séance terminée : ${score.bonnes}/${score.total} bonnes réponses !`;
  }
}

async function enregistrerReponse(notionId, correct) {
  try {
    const ref = doc(db, "progressionAnglais", notionId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const data = snap.data();
    let niveau = data.niveau || 0;
    niveau = correct ? Math.min(niveau + 1, 5) : Math.max(niveau - 1, 0);
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
    const extraireCoursAnglais = httpsCallable(functions, "extraireCoursAnglais", { timeout: 300000 });
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
async function loadNotions() {
  const el = document.getElementById("notions-list");
  const snap = await getDocs(collection(db, "progressionAnglais"));
  notionsById = {};
  const rows = [];
  snap.forEach(d => { notionsById[d.id] = { id: d.id, ...d.data() }; rows.push(notionsById[d.id]); });
  rows.sort((a, b) => a.niveau - b.niveau);

  el.innerHTML = "";
  if (!rows.length) {
    el.innerHTML = `<p class="muted">Pas encore de notion — ajoute un cours pour commencer.</p>`;
    return;
  }
  rows.forEach(n => {
    const row = document.createElement("div");
    row.className = "notion-row";
    const badge = n.niveau >= 4 ? "🟢" : n.niveau >= 2 ? "🟡" : "🔴";
    row.innerHTML = `
      <span class="notion-badge">${badge}</span>
      <div>
        <div class="notion-type">${n.type === "vocabulaire" ? "Vocabulaire" : "Grammaire"}</div>
        <div>${n.label}</div>
      </div>`;
    row.addEventListener("click", () => openNotionModal(n.id));
    el.appendChild(row);
  });
}

async function openNotionModal(notionId) {
  let notion = notionsById[notionId];
  if (!notion) {
    const snap = await getDoc(doc(db, "progressionAnglais", notionId));
    if (!snap.exists()) return;
    notion = { id: notionId, ...snap.data() };
  }
  const coursSnap = await getDoc(doc(db, "coursAnglais", notion.coursId));
  const cours = coursSnap.exists() ? coursSnap.data() : null;

  document.getElementById("modal-titre").textContent = notion.label;
  const corps = document.getElementById("modal-corps");
  if (notion.type === "vocabulaire") {
    const v = cours?.vocabulaire?.find(x => x.mot === notion.label);
    corps.innerHTML = v
      ? `<p><strong>${v.mot}</strong> = ${v.traduction}</p><p class="exemple">${v.exemple || ""}</p>`
      : `<p>Mot : ${notion.label}</p>`;
  } else {
    const g = cours?.grammaire?.find(x => x.titre === notion.label);
    corps.innerHTML = g
      ? `<p>${g.explication}</p>${(g.exemples || []).map(ex => `<p class="exemple">${ex}</p>`).join("")}`
      : `<p>${notion.label}</p>`;
  }
  document.getElementById("modal-notion").hidden = false;
}

document.getElementById("modal-close").addEventListener("click", () => {
  document.getElementById("modal-notion").hidden = true;
});
