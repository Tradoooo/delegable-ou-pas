/**
 * Lecture de la source vivante Claude Code (lot « les autres clients agents »).
 *
 * Le seul morceau du dépôt qui touche à `~/.claude/projects` : parcours récursif
 * des fichiers `.jsonl`, regroupement par `sessionId`, et les règles d'anonymat
 * appliquées à toute valeur destinée au jeu versionné. Le dépôt est PUBLIC :
 * aucun prompt, aucun contenu de message, aucun titre de conversation, aucun
 * chemin absolu, aucun email, aucun identifiant de session brut, aucun nom de
 * personne n'y a sa place — un seul texte oublié est une fuite irrémédiable
 * dans l'historique git.
 *
 * C'est de la récolte, pas du domaine : lecture seule, aucun réseau, aucune API
 * payante. Les faits deviennent des `SessionReelle` dans `src/collect/claude-code.ts`,
 * module pur qui ne lit rien.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SORTIE_DEFAUT = resolve(RACINE, 'src', 'sample', 'claude-code-real.json');
export const PROJETS_DEFAUT = join(homedir(), '.claude', 'projects');
export const MS_PAR_HEURE = 3_600_000;

/** La valeur non-modèle du flux : jamais exportée telle quelle. */
const SYNTHETIQUE = '<synthetic>';
/** Le modèle qu'on ne connaît pas, dans le vocabulaire du contrat. */
const MODELE_INCONNU = { provider: 'inconnu', id: 'inconnu' };
/** Absent = -1, jamais 0 (contrat §1) : coût modèle et durée non horodatée. */
export const INCONNU = -1;

/** Clés qui ne doivent jamais apparaître dans le jeu versionné. */
export const CLES_INTERDITES = /^(text|content|prompt|prompts|title|titles|message|messages|thinking|customtitle|aititle|lastprompt|excerpt|snippet|body|cwd|directory|path|file|email|user|owner|account|organization|uuid|parentuuid|requestid|sessionid|slug|prurl|prrepository)$/i;

/* ------------------------------------------------------------------ motifs */

/**
 * Motifs qui ne doivent jamais atteindre le dépôt public : email, chemin
 * personnel, identifiant brut, empreinte longue, clé d'API.
 */
const REGLE_VERIFICATION = [
  { nom: 'email', motif: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { nom: 'chemin absolu', motif: /\/(?:home|Users|root|private|var)\// },
  { nom: 'UUID brut', motif: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
  { nom: 'empreinte longue', motif: /\b[0-9a-f]{24,}\b/i },
  { nom: 'clé API', motif: /\bsk[-_][A-Za-z0-9_-]{16,}/ },
  { nom: 'jeton', motif: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/ },
  { nom: 'identifiant de message', motif: /\b(?:ses|msg|prt|pt|req)_[A-Za-z0-9]{6,}/ },
  { nom: 'valeur non-modèle', motif: /<synthetic>/i },
  { nom: 'balise', motif: /^[<>].*[<>]$/ },
];

/** Un UUID occupe tout un segment de chemin : le segment disparaît avec lui. */
const MOTIF_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/* -------------------------------------------------------------------- util */

/** Vrai quand `enfant` est `parent` ou l'un de ses descendants. */
function estSous(enfant, parent) {
  const rel = relative(parent, enfant);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Hash stable et court : la clé publique d'une session, jamais son id. */
export function hacher(id) {
  return `cc_${createHash('sha256').update(String(id)).digest('hex').slice(0, 16)}`;
}

/** Entier sûr : une valeur absente ou fausse ne casse pas l'agrégat. */
export function entier(valeur) {
  const nombre = Number(valeur);
  return Number.isFinite(nombre) ? Math.round(nombre) : 0;
}

/** Millisecondes ISO → millisecondes epoch, `NaN` si la date est absente. */
export function epochMs(valeur) {
  if (typeof valeur !== 'string' || valeur === '') return Number.NaN;
  return Date.parse(valeur);
}

/**
 * Vrai si une valeur de sortie ressemble encore à une donnée personnelle ou à
 * du texte libre. Garde finale : elle est appliquée à CHAQUE valeur du jeu,
 * champ par champ, avant toute écriture.
 */
export function contientDonneePersonnelle(valeur, maison) {
  const texte = String(valeur ?? '');
  if (texte === '') return false;
  if (REGLE_VERIFICATION.some((regle) => regle.motif.test(texte))) return true;
  if (/\s/.test(texte) && texte.trim().split(/\s+/).length > 2) return true;
  return logins(maison).some((login) => new RegExp(`\\b${login}\\b`, 'i').test(texte));
}

/**
 * Logins à effacer : celui de la maison et celui de l'espace de travail
 * déclaré. Le dépôt est public : un nom d'utilisateur n'y a pas sa place.
 */
export function logins(maison) {
  const candidats = new Set();
  for (const racine of [maison, homedir()]) {
    const nom = basename(String(racine ?? ''));
    if (nom !== '' && nom !== '.' && nom !== sep) candidats.add(nom);
  }
  return [...candidats];
}

/* ---------------------------------------------------------------- anonymat */

/**
 * Nom de projet public : le répertoire de travail, relatif à la maison,
 * jamais absolu, sans UUID. `/home/x/Bureau/projet` devient `Bureau/projet`,
 * un espace de travail jetable devient `tmp`, tout le reste `externe`.
 */
export function nomProjet(directory, maison) {
  const chemin = String(directory ?? '');
  if (chemin === '') return 'inconnu';
  if (!chemin.startsWith('/')) return segmenter(chemin);
  if (chemin === maison) return 'home';
  const rel = relative(maison, chemin);
  if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) return segmenter(rel);
  if (estSous(chemin, tmpdir())) return 'tmp';
  return 'externe';
}

/** Segments vides (UUID retirés) et séparateurs étrangers : normalisés. */
function segmenter(chemin) {
  const propre = chemin.split(sep).join('/').replace(MOTIF_UUID, '');
  return propre.split('/').filter((segment) => segment !== '').join('/');
}

/** Étiquette d'un modèle : `fournisseur/identifiant`, jamais de barre orpheline. */
export function etiqueter(modele) {
  const id = String(modele.id ?? '').trim();
  const provider = String(modele.provider ?? '').trim();
  if (id !== '' && provider !== '') return `${provider}/${id}`;
  if (id !== '') return id;
  return provider;
}

/**
 * Le modèle du flux, ramené au vocabulaire du contrat. `<synthetic>` n'est pas
 * un modèle : c'est la marque d'une ligne synthétisée par le client, donc un
 * modèle inconnu — comme une valeur vide.
 */
export function normaliserModele(valeur) {
  const id = String(valeur ?? '').trim();
  if (id === '' || id === SYNTHETIQUE) return MODELE_INCONNU;
  if (/^claude-/i.test(id)) return { provider: 'anthropic', id };
  return { provider: 'inconnu', id };
}

/* ------------------------------------------------------- lecture de la source */

/** Liste récursive des `.jsonl` d'un répertoire de projets, triée (déterminisme). */
function listerFichiers(racine) {
  const trouve = [];
  const pile = [racine];
  while (pile.length > 0) {
    const courant = pile.pop();
    let entrees;
    try {
      if (!existsSync(courant) || !statSync(courant).isDirectory()) continue;
      entrees = readdirSync(courant, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entree of entrees) {
      const chemin = join(courant, entree.name);
      if (entree.isDirectory()) pile.push(chemin);
      else if (entree.isFile() && entree.name.endsWith('.jsonl')) trouve.push(chemin);
    }
  }
  return trouve.sort();
}

/** Une ligne lue, ou `null` si elle est vide ou illisible. */
function lireLigne(ligne) {
  const texte = ligne.trim();
  if (texte === '') return null;
  try {
    const objet = JSON.parse(texte);
    return typeof objet === 'object' && objet !== null ? objet : null;
  } catch {
    return null;
  }
}

/**
 * Parcours la source et regroupe par `sessionId`. Ne rend que des compteurs :
 * rien du contenu des lignes n'est conservé en mémoire à la sortie.
 */
export function lireSessions(racineProjets) {
  const fichiers = listerFichiers(racineProjets);
  const parSession = new Map();
  const compte = { fichiers: fichiers.length, lignes: 0, illisibles: 0, sansSession: 0, avecTimestamp: 0, cout: 0 };
  for (const chemin of fichiers) {
    let contenu;
    try {
      contenu = readFileSync(chemin, 'utf8');
    } catch {
      continue;
    }
    for (const brute of contenu.split('\n')) {
      const ligne = lireLigne(brute);
      if (ligne === null) {
        if (brute.trim() !== '') compte.illisibles += 1;
        continue;
      }
      compte.lignes += 1;
      if (typeof ligne.timestamp === 'string' && ligne.timestamp !== '') compte.avecTimestamp += 1;
      if (ligne.type === 'cost-state') compte.cout += 1;
      const id = ligne.sessionId;
      if (typeof id !== 'string' || id === '') {
        compte.sansSession += 1;
        continue;
      }
      const se = parSession.get(id) ?? [];
      se.push(ligne);
      parSession.set(id, se);
    }
  }
  return { parSession, compte };
}
