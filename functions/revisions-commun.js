// Partagé entre les Cloud Functions et les scripts locaux (traitement des cours « je peux attendre »).

const PARENT_UID = "GoxalGBKNWcyC6OkdENgz8j1u883";
const LUCIE_UID = "BmPJ62Hhb0V572vQgzwzybbnU8s2";
const RECAP_DESTINATAIRE = "gbornand@gmail.com";
const ELEVES = {
  [LUCIE_UID]: { prenom: "Lucie", niveau: "college", matieres: ["anglais", "espagnol", "maths", "tables", "musique", "japonais", "physique", "svt", "histoire", "francais"] },
  "PKRatKwnzDZt0BzZjMfO3PFnGxU2": { prenom: "Léonie", niveau: "ce2", matieres: ["francais", "dictee", "tables", "musique", "japonais", "maths", "anglais", "histoire"] },
};
const NOMS_MATIERES = { anglais: "anglais", espagnol: "espagnol", francais: "français", dictee: "dictée", tables: "tables de multiplication", musique: "musique", japonais: "japonais", maths: "mathématiques", physique: "physique-chimie", svt: "SVT", histoire: "histoire-géographie" };
const SCIENCES = ["maths", "physique"];
const MATIERES_DOCUMENTS = ["svt", "histoire"];

function slugAnglais(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function todayISOAnglais() { return new Date().toISOString().slice(0, 10); }

function publicEleve(profil) {
  return profil.niveau === "ce2" ? "une élève française de CE2 (8 ans)" : "une collégienne française";
}

function profDe(matiere) {
  return { anglais: "prof d'anglais", espagnol: "prof d'espagnol", francais: "maîtresse de CE2", dictee: "maîtresse de CE2", maths: "prof de maths", physique: "prof de physique-chimie", svt: "prof de SVT", histoire: "prof d'histoire-géographie" }[matiere];
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
  if (matiere === "espagnol") {
    return `Tu es un(e) ${profDe(matiere)} qui prépare le travail de ${publicEleve(profil)}, qui DÉBUTE l'espagnol (première année). Analyse le cours d'espagnol fourni.
${schema(`{ "mot": "mot ou expression en espagnol, avec son article pour un nom (el, la, los, las) et ses accents exacts", "traduction": "traduction en français", "theme": "thème court en français", "exemple": "courte phrase d'exemple très simple en espagnol" }`,
  `{ "titre": "nom court de la notion (grammaire, conjugaison, prononciation)", "explication": "explication pédagogique très claire en français, pour une débutante", "exemples": ["phrase d'exemple en espagnol"] }`)}
VOCABULAIRE : sois EXHAUSTIF. Parcours chaque page et relève TOUS les mots et expressions (listes, tableaux, encadrés, dialogues, mots illustrés), sans omettre ni résumer. Garde les accents et les signes ¿ ¡. Regroupe par "theme" (titre de rubrique du cours s'il existe).
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

const MODELE_LECTURE = "claude-sonnet-5-5";
const MODELE_LEGER = "claude-haiku-5-5";
function modelePour(matiere) { return SCIENCES.includes(matiere) ? MODELE_LECTURE : MODELE_LEGER; }

// Écrit un cours extrait (nouveau doc, ou doc « en attente » existant) et une fiche de suivi par notion, due aujourd'hui.
async function enregistrerCoursExtrait(db, { eleve, matiere, parsed, prepa = null, coursId = null }) {
  const ref = coursId ? db.collection("coursAnglais").doc(coursId) : db.collection("coursAnglais").doc();
  const donnees = {
    eleve, matiere,
    ...(prepa ? { prepa } : {}),
    titre: parsed.titre || `Cours de ${NOMS_MATIERES[matiere]}`,
    recap: parsed.recap || "",
    vocabulaire: parsed.vocabulaire || [],
    grammaire: parsed.grammaire || [],
  };
  if (coursId) {
    const { FieldValue } = require("firebase-admin/firestore");
    await ref.update({ ...donnees, statut: FieldValue.delete(), prepareLe: new Date().toISOString() });
  } else {
    await ref.set({ ...donnees, dateAjout: new Date().toISOString() });
  }
  const base = { eleve, matiere, coursId: ref.id, niveau: 0, dernierResultat: null, prochaineDate: todayISOAnglais(), dernierVu: null };
  const ecritures = [
    ...(parsed.vocabulaire || []).map(v => [`vocab_${ref.id}_${slugAnglais(v.mot)}`, { ...base, type: "vocabulaire", label: v.mot, theme: v.theme || "", ...(v.prioritaire ? { prioritaire: true } : {}) }]),
    ...(parsed.grammaire || []).map(g => [`gram_${ref.id}_${slugAnglais(g.titre)}`, { ...base, type: "grammaire", label: g.titre, ...(g.categorie ? { categorie: g.categorie } : {}) }]),
  ];
  for (let i = 0; i < ecritures.length; i += 400) {
    const batch = db.batch();
    for (const [id, data] of ecritures.slice(i, i + 400)) batch.set(db.collection("progressionAnglais").doc(id), data, { merge: true });
    await batch.commit();
  }
  return ref.id;
}

module.exports = {
  PARENT_UID, LUCIE_UID, RECAP_DESTINATAIRE, ELEVES, NOMS_MATIERES, SCIENCES, MATIERES_DOCUMENTS,
  slugAnglais, todayISOAnglais, publicEleve, profDe, NOTATION_SCIENCES, consigneExtraction,
  MODELE_LECTURE, MODELE_LEGER, modelePour, enregistrerCoursExtrait,
};
