#!/usr/bin/env node
/**
 * Récolte de la télémétrie Claude Code (lot « les autres clients agents »).
 *
 * Seul morceau du dépôt qui lit la base vivante : le parcours récursif des
 * fichiers `.jsonl` de `~/.claude/projects` (contrat §4.6 : jamais dans un
 * test, jamais dans la CI). Le script regroupe les lignes par `sessionId`,
 * n'en garde que des faits numériques, hache les identifiants et écrit un jeu
 * versionné, trié, déterministe et sans aucune donnée personnelle.
 *
 * Le dépôt est PUBLIC et ces sessions sont des conversations personnelles : la
 * règle n'est pas une option. Ce qui sort d'ici, et rien d'autre : id de
 * session haché (`cc_` + 16 hex) ; projet RELATIF (jamais un chemin absolu,
 * jamais le login) ; modèle `{provider, id}`, où `<synthetic>` n'est pas un
 * modèle donc devient inconnu ; jetons d'entrée, de sortie, de création et de
 * lecture de cache ; durée en millisecondes entre premier et dernier
 * horodatage, bornes ISO, branche git ; `issueKey` à `null` (aucune preuve de
 * ticket dans ce flux) ; `costEuros` à `-1` (le prix n'est pas facturé ici :
 * absent = -1, jamais 0, contrat §1).
 *
 * Ce qui ne sort JAMAIS : un prompt, un contenu de message, un titre de
 * conversation (lignes `custom-title`, `ai-title`), un extrait, un chemin
 * absolu, un email, un identifiant de session brut, un nom de personne.
 *
 * Règles : lecture seule, aucun réseau, aucune API payante ; même source ⇒
 * même fichier (tri par id haché, `generatedAt` dérivé des données, jamais de
 * l'horloge) ; `contientDonneePersonnelle()` refuse l'écriture dès qu'une
 * valeur de sortie ressemble à du texte libre ou à un identifiant personnel ;
 * `--dry-run` affiche le résumé sans rien écrire.
 * Usage :
 *   node tools/claude-code/harvest.mjs [--projects <rep>] [--out <fichier>]
 *                                      [--home <rep>] [--dry-run]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLES_INTERDITES, INCONNU, MS_PAR_HEURE, PROJETS_DEFAUT, SORTIE_DEFAUT,
  contientDonneePersonnelle, entier, epochMs, etiqueter, hacher, lireSessions,
  nomProjet, normaliserModele,
} from './source-jsonl.mjs';

/* --------------------------------------------------------- agrégation fine */

/** Le squelette d'une session en cours d'agrégation. */
function nouvelleAgregee() {
  return {
    debuts: [],
    fins: [],
    jetons: { tokensIn: 0, tokensOut: 0, cacheCreation: 0, cacheRead: 0 },
    modeles: new Map(),
    projets: new Map(),
    branches: new Map(),
    lignes: 0,
    lignesAssistant: 0,
  };
}

/** Incrémente un compteur de valeurs (modèle, projet, branche). */
function compter(compteur, valeur) {
  if (typeof valeur !== 'string' || valeur === '') return;
  compteur.set(valeur, (compteur.get(valeur) ?? 0) + 1);
}

/** La valeur la plus fréquente, départagée alphabétiquement : déterministe. */
function majoritaire(compteur) {
  let meilleure = '';
  let meilleurNombre = -1;
  for (const [valeur, nombre] of [...compteur.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (nombre > meilleurNombre) {
      meilleure = valeur;
      meilleurNombre = nombre;
    }
  }
  return meilleure;
}

/** Absorbe une ligne : horodatage, jetons déclarés, modèle, projet, branche. */
function absorber(agregee, ligne) {
  agregee.lignes += 1;
  const ms = epochMs(ligne.timestamp);
  if (Number.isFinite(ms)) {
    agregee.debuts.push(ms);
    agregee.fins.push(ms);
  }
  compter(agregee.projets, typeof ligne.cwd === 'string' ? ligne.cwd : '');
  compter(agregee.branches, typeof ligne.gitBranch === 'string' ? ligne.gitBranch : '');
  const message = typeof ligne.message === 'object' && ligne.message !== null ? ligne.message : null;
  if (ligne.type !== 'assistant' || message === null) return;
  agregee.lignesAssistant += 1;
  compter(agregee.modeles, typeof message.model === 'string' ? message.model : '');
  const usage = typeof message.usage === 'object' && message.usage !== null ? message.usage : null;
  if (usage === null) return;
  agregee.jetons.tokensIn += entier(usage.input_tokens);
  agregee.jetons.tokensOut += entier(usage.output_tokens);
  agregee.jetons.cacheCreation += entier(usage.cache_creation_input_tokens);
  agregee.jetons.cacheRead += entier(usage.cache_read_input_tokens);
}

/**
 * Une session publique, prête à écrire : des faits numériques et des
 * identifiants hachés. `issueKey` vaut `null` — ce flux ne porte aucune preuve
 * de rattachement à un ticket ; `costEuros` vaut `-1` — ce flux ne porte
 * aucun prix facturé.
 */
function construireSession(id, lignes, maison) {
  const agregee = nouvelleAgregee();
  for (const ligne of lignes) absorber(agregee, ligne);
  const debutMs = agregee.debuts.length > 0 ? Math.min(...agregee.debuts) : Number.NaN;
  const finMs = agregee.fins.length > 0 ? Math.max(...agregee.fins) : Number.NaN;
  const connu = Number.isFinite(debutMs) && Number.isFinite(finMs);
  return {
    id: hacher(id),
    project: nomProjet(majoritaire(agregee.projets), maison),
    branch: majoritaire(agregee.branches),
    model: normaliserModele(majoritaire(agregee.modeles)),
    costEuros: INCONNU,
    tokensIn: agregee.jetons.tokensIn,
    tokensOut: agregee.jetons.tokensOut,
    cacheCreation: agregee.jetons.cacheCreation,
    cacheRead: agregee.jetons.cacheRead,
    durationMs: connu ? Math.max(0, finMs - debutMs) : INCONNU, // -1 : aucun horodatage
    startedAt: connu ? new Date(debutMs).toISOString() : '',
    endedAt: connu ? new Date(finMs).toISOString() : '',
    issueKey: null,
  };
}

/** Transformation complète : une session agrégée par identifiant, triée par id. */
function transformer(parSession, maison) {
  const sessions = [];
  for (const [id, lignes] of parSession) sessions.push(construireSession(id, lignes, maison));
  return sessions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/* ------------------------------------------------------------------ garde-fou */

/**
 * Contrôle le jeu AVANT écriture : aucune clé interdite, aucune valeur
 * personnelle ni texte libre. Rend la liste des griefs, vide si publiable.
 */
function griefs(session, maison) {
  const trouve = [];
  for (const [cle, valeur] of Object.entries(session)) {
    if (CLES_INTERDITES.test(cle)) trouve.push(`clé interdite : ${cle}`);
    if (valeur !== null && contientDonneePersonnelle(valeur, maison)) {
      trouve.push(`valeur personnelle dans ${cle}`);
    }
  }
  for (const [cle, valeur] of Object.entries(session.model)) {
    if (contientDonneePersonnelle(valeur, maison)) trouve.push(`valeur personnelle dans model.${cle}`);
  }
  if (session.issueKey !== null) trouve.push('issueKey non null : aucune preuve de ticket dans ce flux');
  if (session.costEuros !== INCONNU) trouve.push('costEuros autre que -1 : le prix n’est pas dans ce flux');
  return trouve;
}

/** Refuse le jeu si une seule session porte une donnée personnelle. */
function verifierAnonymat(sessions, maison) {
  const problemes = [];
  for (const session of sessions) {
    const trouve = griefs(session, maison);
    if (trouve.length > 0) problemes.push(`${session.id} : ${trouve.join(', ')}`);
  }
  if (problemes.length > 0) {
    throw new Error(`jeu refusé (${problemes.length} session(s)) :\n  ${problemes.slice(0, 5).join('\n  ')}`);
  }
  return problemes.length;
}

/* -------------------------------------------------------------- sérialisation */

/** Le jeu tel que versionné : même forme que `src/sample/opencode-real.json`. */
function datasetDe(sessions) {
  const dernier = sessions.reduce((max, s) => Math.max(max, Date.parse(s.endedAt) || 0), 0);
  return {
    generatedAt: new Date(dernier).toISOString(),
    source: 'claude-code',
    sessions,
  };
}

/** Sérialise une session par ligne : fichier lisible, diff jouable, octets stables. */
function serialiser(dataset) {
  const corps = dataset.sessions.map((session) => `    ${JSON.stringify(session)}`);
  return [
    '{',
    `  "generatedAt": ${JSON.stringify(dataset.generatedAt)},`,
    `  "source": ${JSON.stringify(dataset.source)},`,
    '  "sessions": [',
    corps.join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
}

/* ------------------------------------------------------------------ résumé */

/** Agrégats réels du jeu : ce que la récolte a produit, en faits seuls. */
function agreger(sessions) {
  const modeles = new Map(), branches = new Map(), projets = new Map();
  let jetons = 0, cache = 0, duree = 0, sansTimestamp = 0;
  for (const session of sessions) {
    jetons += session.tokensIn + session.tokensOut;
    cache += session.cacheRead + session.cacheCreation;
    duree += Math.max(0, session.durationMs);
    if (session.startedAt === '') sansTimestamp += 1;
    modeles.set(etiqueter(session.model), (modeles.get(etiqueter(session.model)) ?? 0) + 1);
    compter(branches, session.branch);
    compter(projets, session.project);
  }
  const trier = (compteur) => [...compteur.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));
  return {
    jetons, cache, duree, sansTimestamp,
    modeles: trier(modeles), branches: trier(branches), projets: trier(projets),
  };
}

/** Affiche le résumé : c'est la preuve que la récolte a produit des faits. */
function afficherResume(dataset, compte, ecrit) {
  const agregats = agreger(dataset.sessions);
  const nombre = (valeur) => valeur.toLocaleString('fr-FR');
  console.log(`Récolte Claude Code — ${ecrit ? 'fichier écrit' : 'simulation (rien écrit)'}`);
  console.log(`  fichiers .jsonl   : ${nombre(compte.fichiers)}`);
  console.log(`  lignes lues       : ${nombre(compte.lignes)} (${nombre(compte.avecTimestamp)} avec timestamp, ${nombre(compte.sansSession)} sans sessionId, ${nombre(compte.illisibles)} illisibles)`);
  console.log(`  sessions retenues : ${nombre(dataset.sessions.length)}`);
  console.log(`  jetons (E+S)      : ${nombre(agregats.jetons)} ; cache (L+C) : ${nombre(agregats.cache)}`);
  console.log(`  durée totale      : ${nombre(Math.round((agregats.duree / MS_PAR_HEURE) * 100) / 100)} h`);
  console.log(`  sans timestamp    : ${nombre(agregats.sansTimestamp)} session(s)`);
  console.log(`  branches          : ${nombre(agregats.branches.length)} ; projets : ${nombre(agregats.projets.length)}`);
  console.log(`  coût facturé      : absent du flux (lignes cost-state : ${nombre(compte.cout)}) → -1`);
  console.log('  répartition par modèle :');
  for (const [modele, sessions] of agregats.modeles) console.log(`    ${modele} : ${nombre(sessions)} session(s)`);
  console.log(`  horodatage retenu : ${dataset.generatedAt}`);
}

/* --------------------------------------------------------------------- CLI */

/** Usage affiché sur demande. */
function usage() {
  return [
    'Récolte de la télémétrie Claude Code (lecture seule, hors CI, sans réseau).',
    'Usage : node tools/claude-code/harvest.mjs [options]',
    '  --projects <répertoire> répertoire des projets (défaut : ~/.claude/projects)',
    '  --out <fichier>         jeu de données écrit (défaut : src/sample/claude-code-real.json)',
    '  --home <répertoire>     racine de l’espace de travail (défaut : la maison)',
    '  --dry-run               affiche le résumé sans rien écrire',
    '  --help                  cette aide',
  ].join('\n');
}

/** Analyse des arguments : options simples, sans dépendance. */
function analyserArgs(argv) {
  const options = { projets: PROJETS_DEFAUT, sortie: SORTIE_DEFAUT, maison: homedir(), simulation: false, aide: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--projects') options.projets = resolve(argv[++i] ?? '');
    else if (arg === '--out') options.sortie = resolve(argv[++i] ?? '');
    else if (arg === '--home') options.maison = resolve(argv[++i] ?? '');
    else if (arg === '--dry-run') options.simulation = true;
    else if (arg === '--help' || arg === '-h') options.aide = true;
    else throw new Error(`option inconnue : ${arg}`);
  }
  return options;
}

/** Point d'entrée : lit la source, agrège, contrôle l'anonymat, écrit. */
function main() {
  let options;
  try {
    options = analyserArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`::error::${err.message}`);
    console.error(usage());
    process.exit(2);
  }
  if (options.aide) {
    console.log(usage());
    return;
  }
  const { parSession, compte } = lireSessions(options.projets);
  const sessions = transformer(parSession, options.maison);
  verifierAnonymat(sessions, options.maison);
  const dataset = datasetDe(sessions);
  if (options.simulation) {
    afficherResume(dataset, compte, false);
    return;
  }
  mkdirSync(dirname(options.sortie), { recursive: true });
  writeFileSync(options.sortie, serialiser(dataset), 'utf8');
  afficherResume(dataset, compte, true);
  console.log(`  fichier            : ${options.sortie}`);
}

main();
