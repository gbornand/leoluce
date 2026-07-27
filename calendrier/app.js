// ============================================================
// Calendrier familial Leoluce — Firebase modular SDK v10, pas de build step
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

const MOIS_NOMS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const FAMILIAL_COLOR = "#4caf50";
const AMIS_FAMILLE_COLOR = "#7a5cc0";
const ENFANTS_AMIS_COLOR = "#c07a3f";

let currentUser = null;
let entries = [];
let bdayUsers = {}; // uid -> {displayName, colorHex, notifyEnabled, preferredHour, email}
let unsubEntries = null, unsubUsers = null;
let currentMonth = new Date().getMonth(); // 0-11
let currentView = "month"; // "month" | "year"

document.getElementById("entry-month").innerHTML = MOIS_NOMS.map((m,i) => `<option value="${i}">${m}</option>`).join("");
document.getElementById("settings-hour").innerHTML = Array.from({length:24}, (_,h) => `<option value="${h}">${String(h).padStart(2,"0")}h</option>`).join("");

// -------------------------------------------------------------
// AUTH
// -------------------------------------------------------------
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

onAuthStateChanged(auth, async (user) => {
  if (user) {
    const myDoc = await getDoc(doc(db, "bdayUsers", user.uid));
    if (!myDoc.exists()) {
      document.getElementById("login-error").textContent = "Ce compte n'est pas configuré pour le calendrier familial. Contacte l'administrateur.";
      document.getElementById("login-error").hidden = false;
      await signOut(auth);
      return;
    }
    currentUser = user;
    showApp();
    startListeners();
  } else {
    currentUser = null;
    if (unsubEntries) unsubEntries();
    if (unsubUsers) unsubUsers();
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
// LISTENERS
// -------------------------------------------------------------
function startListeners() {
  unsubEntries = onSnapshot(collection(db, "bdayEntries"), (snap) => {
    entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  });
  unsubUsers = onSnapshot(collection(db, "bdayUsers"), (snap) => {
    bdayUsers = {};
    snap.docs.forEach(d => { bdayUsers[d.id] = d.data(); });
    renderAll();
  });
}

function renderAll() {
  renderUpcoming();
  if (currentView === "month") renderMonthView(); else renderYearView();
  updateMonthLabel();
}

// -------------------------------------------------------------
// HELPERS
// -------------------------------------------------------------
function colorFor(entry) {
  if (entry.category === "familial") return FAMILIAL_COLOR;
  if (entry.category === "amis_famille") return AMIS_FAMILLE_COLOR;
  if (entry.category === "enfants_amis") return ENFANTS_AMIS_COLOR;
  return bdayUsers[entry.ownerUid]?.colorHex || "#999";
}
function ageAt(entry, targetDate) {
  if (!entry.birthYear) return null;
  return targetDate.getFullYear() - entry.birthYear -
    ((targetDate.getMonth() + 1 < entry.month || (targetDate.getMonth() + 1 === entry.month && targetDate.getDate() < entry.day)) ? 1 : 0);
}
function fullName(entry) {
  return [entry.firstName, entry.lastName].filter(Boolean).join(" ");
}
function nextOccurrence(entry, from) {
  // Prochaine date (cette année ou l'an prochain) où tombe cet anniversaire, à partir de `from` (minuit)
  let year = from.getFullYear();
  let d = new Date(year, entry.month - 1, entry.day);
  if (d < from) d = new Date(year + 1, entry.month - 1, entry.day);
  return d;
}

// -------------------------------------------------------------
// PROCHAINS ANNIVERSAIRES (30 jours)
// -------------------------------------------------------------
function renderUpcoming() {
  const today = new Date(); today.setHours(0,0,0,0);
  const horizon = new Date(today); horizon.setDate(horizon.getDate() + 30);
  const list = entries
    .map(e => ({ e, date: nextOccurrence(e, today) }))
    .filter(x => x.date <= horizon)
    .sort((a, b) => a.date - b.date);

  const el = document.getElementById("upcoming-list");
  if (!list.length) { el.innerHTML = `<div class="upcoming-empty">Aucun anniversaire dans les 30 prochains jours.</div>`; return; }
  el.innerHTML = list.map(({ e, date }) => {
    const age = ageAt(e, date);
    return `<div class="upcoming-item" data-id="${e.id}">
      <span class="upcoming-dot" style="background:${colorFor(e)}"></span>
      <span class="upcoming-name">${escapeHtml(fullName(e))}${e.status === "aConfirmer" ? " ⚠" : ""}</span>
      <span class="upcoming-date">${date.getDate()} ${MOIS_NOMS[date.getMonth()]}</span>
      ${age !== null ? `<span class="upcoming-age">${age} ans</span>` : ""}
    </div>`;
  }).join("");
  el.querySelectorAll("[data-id]").forEach(row => row.addEventListener("click", () => openEntryModal(row.dataset.id)));
}

// -------------------------------------------------------------
// VUE MOIS
// -------------------------------------------------------------
function updateMonthLabel() {
  document.getElementById("current-month-label").textContent = MOIS_NOMS[currentMonth];
}
document.getElementById("btn-prev-month").addEventListener("click", () => { currentMonth = (currentMonth + 11) % 12; renderAll(); });
document.getElementById("btn-next-month").addEventListener("click", () => { currentMonth = (currentMonth + 1) % 12; renderAll(); });

function entriesForMonth(monthIndex /* 0-11 */) {
  return entries.filter(e => e.month === monthIndex + 1).sort((a, b) => a.day - b.day);
}

function renderMonthView() {
  const el = document.getElementById("month-view");
  const list = entriesForMonth(currentMonth);
  if (!list.length) { el.innerHTML = `<div class="month-empty">Aucun anniversaire en ${MOIS_NOMS[currentMonth].toLowerCase()}.</div>`; return; }
  el.innerHTML = list.map(e => `
    <div class="month-entry" data-id="${e.id}">
      <span class="month-entry-day">${e.day}</span>
      <span class="month-entry-dot" style="background:${colorFor(e)}"></span>
      <span class="month-entry-name">${escapeHtml(fullName(e))}${e.birthYear ? ` <span style="color:var(--muted);font-weight:400">(${e.birthYear})</span>` : ""}</span>
      ${e.status === "aConfirmer" ? `<span class="month-entry-notconfirmed">À confirmer</span>` : ""}
    </div>`).join("");
  el.querySelectorAll("[data-id]").forEach(row => row.addEventListener("click", () => openEntryModal(row.dataset.id)));
}

// -------------------------------------------------------------
// VUE ANNÉE
// -------------------------------------------------------------
function renderYearView() {
  const el = document.getElementById("year-view");
  el.innerHTML = MOIS_NOMS.map((nom, i) => {
    const list = entriesForMonth(i);
    return `<div class="year-grid-month">
      <h4>${nom}</h4>
      ${list.length ? list.map(e => `
        <div class="year-grid-item" data-id="${e.id}" style="cursor:pointer">
          <span class="year-grid-dot" style="background:${colorFor(e)}"></span>
          ${e.day} — ${escapeHtml(fullName(e))}
        </div>`).join("") : `<div class="year-grid-item" style="color:var(--muted);font-style:italic">—</div>`}
    </div>`;
  }).join("");
  el.querySelectorAll("[data-id]").forEach(row => row.addEventListener("click", () => openEntryModal(row.dataset.id)));
}

document.getElementById("btn-view-year").addEventListener("click", () => {
  currentView = "year";
  document.getElementById("year-view").hidden = false;
  document.getElementById("month-view").hidden = true;
  document.getElementById("btn-view-year").classList.add("active");
  document.getElementById("btn-view-month").classList.remove("active");
  renderAll();
});
document.getElementById("btn-view-month").addEventListener("click", () => {
  currentView = "month";
  document.getElementById("year-view").hidden = true;
  document.getElementById("month-view").hidden = false;
  document.getElementById("btn-view-month").classList.add("active");
  document.getElementById("btn-view-year").classList.remove("active");
  renderAll();
});

// -------------------------------------------------------------
// RECHERCHE
// -------------------------------------------------------------
document.getElementById("search-input").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  const panelSearch = document.getElementById("panel-search");
  if (!q) { panelSearch.hidden = true; return; }
  panelSearch.hidden = false;
  const matches = entries.filter(en => fullName(en).toLowerCase().includes(q));
  const el = document.getElementById("search-results");
  el.innerHTML = matches.length ? matches.map(en => `
    <div class="upcoming-item" data-id="${en.id}">
      <span class="upcoming-dot" style="background:${colorFor(en)}"></span>
      <span class="upcoming-name">${escapeHtml(fullName(en))}</span>
      <span class="upcoming-date">${en.day} ${MOIS_NOMS[en.month - 1]}${en.birthYear ? ` (${en.birthYear})` : ""}</span>
    </div>`).join("") : `<div class="upcoming-empty">Aucun résultat.</div>`;
  el.querySelectorAll("[data-id]").forEach(row => row.addEventListener("click", () => openEntryModal(row.dataset.id)));
});

// -------------------------------------------------------------
// AJOUT / ÉDITION / SUPPRESSION
// -------------------------------------------------------------
document.getElementById("btn-add").addEventListener("click", () => openEntryModal(null));

function openEntryModal(id) {
  const e = id ? entries.find(x => x.id === id) : null;
  document.getElementById("modal-entry-title").textContent = e ? "Modifier l'anniversaire" : "Nouvel anniversaire";
  document.getElementById("entry-id").value = id || "";
  document.getElementById("entry-firstname").value = e?.firstName || "";
  document.getElementById("entry-lastname").value = e?.lastName || "";
  document.getElementById("entry-day").value = e?.day || "";
  document.getElementById("entry-month").value = e ? e.month - 1 : new Date().getMonth();
  document.getElementById("entry-year").value = e?.birthYear || "";
  document.getElementById("entry-category").value = e?.category || "familial";
  document.getElementById("entry-group").value = e?.group || "";
  document.getElementById("entry-alert").checked = e ? !!e.alertEnabled : true;
  document.getElementById("entry-notes").value = e?.notes || "";
  document.getElementById("btn-delete-entry").hidden = !id;
  document.getElementById("entry-status-badge").hidden = !(e?.status === "aConfirmer");
  openModal("modal-entry");
}

document.getElementById("entry-category").addEventListener("change", (e) => {
  if (!document.getElementById("entry-id").value) {
    document.getElementById("entry-alert").checked = e.target.value === "familial";
  }
});

document.getElementById("form-entry").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("entry-id").value;
  const payload = {
    firstName: document.getElementById("entry-firstname").value.trim(),
    lastName: document.getElementById("entry-lastname").value.trim() || null,
    day: Number(document.getElementById("entry-day").value),
    month: Number(document.getElementById("entry-month").value) + 1,
    birthYear: Number(document.getElementById("entry-year").value) || null,
    category: document.getElementById("entry-category").value,
    group: document.getElementById("entry-group").value.trim() || null,
    alertEnabled: document.getElementById("entry-alert").checked,
    notes: document.getElementById("entry-notes").value.trim() || null,
    updatedAt: serverTimestamp(),
  };
  if (id) {
    await updateDoc(doc(db, "bdayEntries", id), payload);
  } else {
    payload.ownerUid = currentUser.uid;
    payload.status = "ok";
    payload.createdAt = serverTimestamp();
    await addDoc(collection(db, "bdayEntries"), payload);
  }
  closeModal("modal-entry");
});

document.getElementById("btn-delete-entry").addEventListener("click", async () => {
  const id = document.getElementById("entry-id").value;
  if (id && confirm("Supprimer cet anniversaire ?")) {
    await deleteDoc(doc(db, "bdayEntries", id));
    closeModal("modal-entry");
  }
});

// -------------------------------------------------------------
// RÉGLAGES NOTIF
// -------------------------------------------------------------
document.getElementById("btn-settings").addEventListener("click", () => {
  const my = bdayUsers[currentUser.uid] || {};
  document.getElementById("settings-notify").checked = my.notifyEnabled !== false;
  document.getElementById("settings-hour").value = my.preferredHour ?? 7;
  openModal("modal-settings");
});

document.getElementById("btn-save-settings").addEventListener("click", async () => {
  await updateDoc(doc(db, "bdayUsers", currentUser.uid), {
    notifyEnabled: document.getElementById("settings-notify").checked,
    preferredHour: Number(document.getElementById("settings-hour").value),
  });
  closeModal("modal-settings");
});

// -------------------------------------------------------------
// UTILS
// -------------------------------------------------------------
window.openModal = (id) => { document.getElementById(id).hidden = false; };
window.closeModal = (id) => { document.getElementById(id).hidden = true; };
function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>'"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;" }[c]));
}
