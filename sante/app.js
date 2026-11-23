// ============================================================
// Suivi santé (règles, migraines, suivi de Lucie) — Firebase modular SDK v10, pas de build step
// Accès réservé à Géraldine (compte unique, pas de notion d'équipe comme le calendrier).
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";

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
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider('6LfszmctAAAAAGf6kh3NFF-Fq-8kDlwm5SURZnnn'),
  isTokenAutoRefreshEnabled: true,
});
const auth = getAuth(app);
const db = getFirestore(app);

const GERALDINE_UID = "GoxalGBKNWcyC6OkdENgz8j1u883";

let currentUser = null;
let regles = [];
let migraines = [];
let lucieEntries = [];
let unsubRegles = null, unsubMigraines = null, unsubLucie = null;
let lucieFilter = "all";

// -------------------------------------------------------------
// AUTH
// -------------------------------------------------------------
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
  const err = document.getElementById("login-error");
  err.hidden = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e2) {
    err.textContent = "Connexion impossible — vérifie l'email et le mot de passe.";
    err.hidden = false;
  }
});

document.getElementById("btn-logout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user) {
    if (user.uid !== GERALDINE_UID) {
      document.getElementById("login-error").textContent = "Ce compte n'est pas autorisé pour ce site.";
      document.getElementById("login-error").hidden = false;
      signOut(auth);
      return;
    }
    currentUser = user;
    showApp();
    startListeners();
  } else {
    currentUser = null;
    if (unsubRegles) unsubRegles();
    if (unsubMigraines) unsubMigraines();
    if (unsubLucie) unsubLucie();
    showLogin();
  }
});

function showApp() {
  document.getElementById("screen-login").hidden = true;
  document.getElementById("screen-app").hidden = false;
}
function showLogin() {
  document.getElementById("screen-login").hidden = false;
  document.getElementById("screen-app").hidden = true;
}

// -------------------------------------------------------------
// ONGLETS PRINCIPAUX
// -------------------------------------------------------------
document.querySelectorAll(".main-tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".main-tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-moi").hidden = btn.dataset.tab !== "moi";
    document.getElementById("tab-lucie").hidden = btn.dataset.tab !== "lucie";
  });
});

// -------------------------------------------------------------
// LISTENERS FIRESTORE
// -------------------------------------------------------------
function startListeners() {
  unsubRegles = onSnapshot(query(collection(db, "santeRegles"), orderBy("dateDebut", "desc")), (snap) => {
    regles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderRegles();
  });
  unsubMigraines = onSnapshot(query(collection(db, "santeMigraines"), orderBy("date", "desc")), (snap) => {
    migraines = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMigraines();
  });
  unsubLucie = onSnapshot(query(collection(db, "santeLucie"), orderBy("date", "desc")), (snap) => {
    lucieEntries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderLucie();
  });
}

// -------------------------------------------------------------
// HELPERS
// -------------------------------------------------------------
function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function daysBetween(isoA, isoB) {
  return Math.round((new Date(isoB) - new Date(isoA)) / 86400000);
}
function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>'"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;" }[c]));
}
function intensityDots(n) {
  return `<span class="intensity-dots">${Array.from({length:5}, (_,i) =>
    `<span class="intensity-dot${i < n ? " filled" : ""}"></span>`).join("")}</span>`;
}
const SYMPTOME_LABELS = {
  crampes: "Crampes", dos: "Mal de dos", seins: "Seins sensibles",
  fatigue: "Fatigue", maux_tete: "Maux de tête", moral: "Moral bas",
};

// -------------------------------------------------------------
// RÈGLES
// -------------------------------------------------------------
function renderRegles() {
  const sorted = [...regles].sort((a, b) => b.dateDebut.localeCompare(a.dateDebut));
  const summaryEl = document.getElementById("summary-regles");
  if (sorted.length) {
    const last = sorted[0];
    const today = new Date().toISOString().slice(0, 10);
    const jourCycle = daysBetween(last.dateDebut, today) + 1;
    let cycleMoyen = null, prochaine = null;
    if (sorted.length >= 2) {
      const diffs = [];
      for (let i = 0; i < sorted.length - 1; i++) diffs.push(daysBetween(sorted[i + 1].dateDebut, sorted[i].dateDebut));
      const recentDiffs = diffs.slice(0, 6);
      cycleMoyen = Math.round(recentDiffs.reduce((a, b) => a + b, 0) / recentDiffs.length);
      const prochaineDate = new Date(last.dateDebut);
      prochaineDate.setDate(prochaineDate.getDate() + cycleMoyen);
      prochaine = prochaineDate.toISOString().slice(0, 10);
    }
    summaryEl.innerHTML = `
      <div class="summary-card"><div class="summary-value">${fmtDate(last.dateDebut)}</div><div class="summary-label">Dernières règles (J${jourCycle})</div></div>
      <div class="summary-card"><div class="summary-value">${cycleMoyen ? cycleMoyen + " j" : "—"}</div><div class="summary-label">Cycle moyen</div></div>
      <div class="summary-card"><div class="summary-value">${prochaine ? fmtDate(prochaine) : "—"}</div><div class="summary-label">Prochaine prévue (estimation)</div></div>
    `;
  } else {
    summaryEl.innerHTML = `<div class="summary-card"><div class="summary-value">—</div><div class="summary-label">Aucune donnée encore</div></div>`;
  }

  const el = document.getElementById("list-regles");
  if (!sorted.length) { el.innerHTML = `<div class="entry-empty">Aucune entrée. Clique sur + pour en ajouter une.</div>`; return; }
  el.innerHTML = sorted.map(r => {
    const duree = r.dateFin ? ` (${daysBetween(r.dateDebut, r.dateFin) + 1} j)` : "";
    const symptomes = (r.symptomes || []).map(s => `<span class="tag-chip">${SYMPTOME_LABELS[s] || s}</span>`).join("");
    return `<div class="entry-row" data-id="${r.id}">
      <div class="entry-row-top">
        <span class="entry-date">${fmtDate(r.dateDebut)}${r.dateFin ? " → " + fmtDate(r.dateFin) : ""}</span>
        <span class="entry-sub">${duree}</span>
        <span class="badge badge-${r.flux}">${r.flux}</span>
      </div>
      ${symptomes}
      ${r.notes ? `<div class="entry-notes">${escapeHtml(r.notes)}</div>` : ""}
    </div>`;
  }).join("");
  el.querySelectorAll("[data-id]").forEach(row => row.addEventListener("click", () => openRegleModal(row.dataset.id)));
}

document.getElementById("btn-add-regle").addEventListener("click", () => openRegleModal(null));

function openRegleModal(id) {
  const r = id ? regles.find(x => x.id === id) : null;
  document.getElementById("modal-regle-title").textContent = r ? "Modifier l'entrée" : "Nouvelle entrée règles";
  document.getElementById("regle-id").value = id || "";
  document.getElementById("regle-debut").value = r?.dateDebut || new Date().toISOString().slice(0, 10);
  document.getElementById("regle-fin").value = r?.dateFin || "";
  document.getElementById("regle-flux").value = r?.flux || "moyen";
  document.querySelectorAll("#regle-symptomes-grid input").forEach(cb => {
    cb.checked = (r?.symptomes || []).includes(cb.value);
  });
  document.getElementById("regle-notes").value = r?.notes || "";
  document.getElementById("btn-delete-regle").hidden = !id;
  openModal("modal-regle");
}

document.getElementById("form-regle").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("regle-id").value;
  const symptomes = Array.from(document.querySelectorAll("#regle-symptomes-grid input:checked")).map(cb => cb.value);
  const payload = {
    uid: currentUser.uid,
    dateDebut: document.getElementById("regle-debut").value,
    dateFin: document.getElementById("regle-fin").value || null,
    flux: document.getElementById("regle-flux").value,
    symptomes,
    notes: document.getElementById("regle-notes").value.trim() || null,
    updatedAt: serverTimestamp(),
  };
  if (id) {
    await updateDoc(doc(db, "santeRegles", id), payload);
  } else {
    payload.createdAt = serverTimestamp();
    await addDoc(collection(db, "santeRegles"), payload);
  }
  closeModal("modal-regle");
});

document.getElementById("btn-delete-regle").addEventListener("click", async () => {
  const id = document.getElementById("regle-id").value;
  if (id && confirm("Supprimer cette entrée ?")) {
    await deleteDoc(doc(db, "santeRegles", id));
    closeModal("modal-regle");
  }
});

// -------------------------------------------------------------
// MIGRAINES (Moi)
// -------------------------------------------------------------
function renderMigraines() {
  const sorted = [...migraines].sort((a, b) => b.date.localeCompare(a.date));
  const summaryEl = document.getElementById("summary-migraines");
  const moisActuel = new Date().toISOString().slice(0, 7);
  const ceMois = sorted.filter(m => m.date.startsWith(moisActuel));
  const moyenne = sorted.length ? (sorted.reduce((a, m) => a + Number(m.intensite || 0), 0) / sorted.length).toFixed(1) : null;
  summaryEl.innerHTML = `
    <div class="summary-card"><div class="summary-value">${ceMois.length}</div><div class="summary-label">Ce mois-ci</div></div>
    <div class="summary-card"><div class="summary-value">${moyenne ?? "—"}</div><div class="summary-label">Intensité moyenne</div></div>
    <div class="summary-card"><div class="summary-value">${sorted.length}</div><div class="summary-label">Total enregistré</div></div>
  `;

  const el = document.getElementById("list-migraines");
  if (!sorted.length) { el.innerHTML = `<div class="entry-empty">Aucune entrée. Clique sur + pour en ajouter une.</div>`; return; }
  el.innerHTML = sorted.map(m => `
    <div class="entry-row" data-id="${m.id}">
      <div class="entry-row-top">
        <span class="entry-date">${fmtDate(m.date)}</span>
        ${intensityDots(Number(m.intensite || 0))}
        ${m.duree ? `<span class="entry-sub">${escapeHtml(m.duree)}</span>` : ""}
        <span class="badge badge-${m.soulagement}">${m.soulagement}</span>
        ${m.aura === "oui" ? `<span class="tag-chip">Aura</span>` : ""}
      </div>
      <div class="entry-sub">${m.declencheur ? "Déclencheur : " + escapeHtml(m.declencheur) : ""}${m.medicament ? (m.declencheur ? " — " : "") + "Médicament : " + escapeHtml(m.medicament) : ""}</div>
      ${m.notes ? `<div class="entry-notes">${escapeHtml(m.notes)}</div>` : ""}
    </div>`).join("");
  el.querySelectorAll("[data-id]").forEach(row => row.addEventListener("click", () => openMigraineModal(row.dataset.id)));
}

document.getElementById("btn-add-migraine").addEventListener("click", () => openMigraineModal(null));

function openMigraineModal(id) {
  const m = id ? migraines.find(x => x.id === id) : null;
  document.getElementById("modal-migraine-title").textContent = m ? "Modifier la migraine" : "Nouvelle migraine";
  document.getElementById("migraine-id").value = id || "";
  document.getElementById("migraine-date").value = m?.date || new Date().toISOString().slice(0, 10);
  const intensite = m?.intensite || 3;
  document.querySelector(`#migraine-intensite-picker input[value="${intensite}"]`).checked = true;
  document.getElementById("migraine-duree").value = m?.duree || "";
  document.getElementById("migraine-soulagement").value = m?.soulagement || "partiel";
  document.getElementById("migraine-aura").value = m?.aura || "non";
  document.getElementById("migraine-declencheur").value = m?.declencheur || "";
  document.getElementById("migraine-medicament").value = m?.medicament || "";
  document.getElementById("migraine-notes").value = m?.notes || "";
  document.getElementById("btn-delete-migraine").hidden = !id;
  openModal("modal-migraine");
}

document.getElementById("form-migraine").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("migraine-id").value;
  const payload = {
    uid: currentUser.uid,
    date: document.getElementById("migraine-date").value,
    intensite: Number(document.querySelector('#migraine-intensite-picker input:checked').value),
    duree: document.getElementById("migraine-duree").value.trim() || null,
    soulagement: document.getElementById("migraine-soulagement").value,
    aura: document.getElementById("migraine-aura").value,
    declencheur: document.getElementById("migraine-declencheur").value.trim() || null,
    medicament: document.getElementById("migraine-medicament").value.trim() || null,
    notes: document.getElementById("migraine-notes").value.trim() || null,
    updatedAt: serverTimestamp(),
  };
  if (id) {
    await updateDoc(doc(db, "santeMigraines", id), payload);
  } else {
    payload.createdAt = serverTimestamp();
    await addDoc(collection(db, "santeMigraines"), payload);
  }
  closeModal("modal-migraine");
});

document.getElementById("btn-delete-migraine").addEventListener("click", async () => {
  const id = document.getElementById("migraine-id").value;
  if (id && confirm("Supprimer cette entrée ?")) {
    await deleteDoc(doc(db, "santeMigraines", id));
    closeModal("modal-migraine");
  }
});

// -------------------------------------------------------------
// LUCIE
// -------------------------------------------------------------
document.querySelectorAll("#lucie-filter button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#lucie-filter button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    lucieFilter = btn.dataset.type;
    renderLucie();
  });
});

function renderLucie() {
  const sorted = [...lucieEntries].sort((a, b) => b.date.localeCompare(a.date));
  const moisActuel = new Date().toISOString().slice(0, 7);
  const ceMois = sorted.filter(l => l.date.startsWith(moisActuel));
  const ventreMois = ceMois.filter(l => l.type === "ventre").length;
  const migraineMois = ceMois.filter(l => l.type === "migraine").length;
  document.getElementById("summary-lucie").innerHTML = `
    <div class="summary-card"><div class="summary-value">${ventreMois}</div><div class="summary-label">🟠 Ventre ce mois-ci</div></div>
    <div class="summary-card"><div class="summary-value">${migraineMois}</div><div class="summary-label">🟣 Migraines ce mois-ci</div></div>
    <div class="summary-card"><div class="summary-value">${sorted.length}</div><div class="summary-label">Total enregistré</div></div>
  `;

  const filtered = lucieFilter === "all" ? sorted : sorted.filter(l => l.type === lucieFilter);
  const el = document.getElementById("list-lucie");
  if (!filtered.length) { el.innerHTML = `<div class="entry-empty">Aucune entrée. Clique sur + pour en ajouter une.</div>`; return; }
  el.innerHTML = filtered.map(l => `
    <div class="entry-row" data-id="${l.id}">
      <div class="entry-row-top">
        <span class="entry-date">${fmtDate(l.date)}</span>
        <span class="badge badge-${l.type}">${l.type === "ventre" ? "🟠 Ventre" : "🟣 Migraine"}</span>
        ${intensityDots(Number(l.intensite || 0))}
        ${l.duree ? `<span class="entry-sub">${escapeHtml(l.duree)}</span>` : ""}
        <span class="badge badge-${l.soulagement}">${l.soulagement}</span>
      </div>
      <div class="entry-sub">${l.contexte ? "Contexte : " + escapeHtml(l.contexte) : ""}${l.medicament ? (l.contexte ? " — " : "") + "Médicament : " + escapeHtml(l.medicament) : ""}</div>
      ${l.notes ? `<div class="entry-notes">${escapeHtml(l.notes)}</div>` : ""}
    </div>`).join("");
  el.querySelectorAll("[data-id]").forEach(row => row.addEventListener("click", () => openLucieModal(row.dataset.id)));
}

document.getElementById("btn-add-lucie").addEventListener("click", () => openLucieModal(null));

function openLucieModal(id) {
  const l = id ? lucieEntries.find(x => x.id === id) : null;
  document.getElementById("modal-lucie-title").textContent = l ? "Modifier l'entrée" : "Nouvelle entrée — Lucie";
  document.getElementById("lucie-id").value = id || "";
  document.getElementById("lucie-date").value = l?.date || new Date().toISOString().slice(0, 10);
  document.getElementById("lucie-type").value = l?.type || "ventre";
  const intensite = l?.intensite || 3;
  document.querySelector(`#lucie-intensite-picker input[value="${intensite}"]`).checked = true;
  document.getElementById("lucie-duree").value = l?.duree || "";
  document.getElementById("lucie-soulagement").value = l?.soulagement || "partiel";
  document.getElementById("lucie-contexte").value = l?.contexte || "";
  document.getElementById("lucie-medicament").value = l?.medicament || "";
  document.getElementById("lucie-notes").value = l?.notes || "";
  document.getElementById("btn-delete-lucie").hidden = !id;
  openModal("modal-lucie");
}

document.getElementById("form-lucie").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("lucie-id").value;
  const payload = {
    uid: currentUser.uid,
    date: document.getElementById("lucie-date").value,
    type: document.getElementById("lucie-type").value,
    intensite: Number(document.querySelector('#lucie-intensite-picker input:checked').value),
    duree: document.getElementById("lucie-duree").value.trim() || null,
    soulagement: document.getElementById("lucie-soulagement").value,
    contexte: document.getElementById("lucie-contexte").value.trim() || null,
    medicament: document.getElementById("lucie-medicament").value.trim() || null,
    notes: document.getElementById("lucie-notes").value.trim() || null,
    updatedAt: serverTimestamp(),
  };
  if (id) {
    await updateDoc(doc(db, "santeLucie", id), payload);
  } else {
    payload.createdAt = serverTimestamp();
    await addDoc(collection(db, "santeLucie"), payload);
  }
  closeModal("modal-lucie");
});

document.getElementById("btn-delete-lucie").addEventListener("click", async () => {
  const id = document.getElementById("lucie-id").value;
  if (id && confirm("Supprimer cette entrée ?")) {
    await deleteDoc(doc(db, "santeLucie", id));
    closeModal("modal-lucie");
  }
});

// -------------------------------------------------------------
// UTILS MODALES
// -------------------------------------------------------------
window.openModal = (id) => { document.getElementById(id).hidden = false; };
window.closeModal = (id) => { document.getElementById(id).hidden = true; };
