/**
 * Télémétrie Claude Code : les sessions réelles d'un deuxième client agent
 * deviennent des faits du contrat (contrat §2 ligne `~/.claude/projects`,
 * §3 « lecteur des sessions d'un client autre qu'OpenCode »).
 *
 * Module PUR : aucun `fs`, aucune horloge, aucun réseau. Il ne lit que le jeu
 * versionné `src/sample/claude-code-real.json`, produit par
 * `tools/claude-code/harvest.mjs` — la base vivante ne se touche jamais ici ni
 * dans un test (contrat §4.6).
 *
 * Deux règles du contrat commandent tout le module :
 *  - **absent = `-1`, jamais `0`** (§1). Le coût modèle n'existe pas dans ce
 *    flux : il vaut `INCONNU`, et un zéro affiché resterait la preuve qu'on a
 *    mesuré zéro ;
 *  - **ce qui n'est pas prouvé n'est pas affirmé** (§2). Une session Claude
 *    Code ne dit pas quel commit elle a produit : `attribution` vaut
 *    `'aucune'`, aucune fenêtre temporelle n'est invoquée.
 *
 * Le dépôt est PUBLIC : ni prompt, ni contenu de message, ni titre de
 * conversation ne remontent du flux. `titre` et `agent` sont donc vides —
 * l'absence de la donnée est une conclusion, pas un détail d'implémentation.
 */
import { INCONNU } from './session-reelle.js';
import type { Attribution, Client, Modele, SessionReelle } from './session-reelle.js';
import { modelLabel } from './opencode.js';

/** Le modèle lu dans le jeu versionné : fournisseur + identifiant. */
export interface ClaudeCodeModele {
  readonly provider: string;
  readonly id: string;
}

/** Une session telle que récoltée : des faits numériques et des ids hachés. */
export interface ClaudeCodeSession {
  /** Clé publique de la session : `cc_` + 16 hex, jamais l'identifiant brut. */
  readonly id: string;
  /** Nom de projet relatif (`Bureau/projet-x`), jamais un chemin absolu. */
  readonly project: string;
  /** Branche git majoritaire de la session, `''` si le flux n'en porte pas. */
  readonly branch: string;
  readonly model: ClaudeCodeModele;
  /** Coût facturé : `-1` ici, le flux ne porte aucun prix (contrat §1). */
  readonly costEuros: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  /** Jetons écrits dans le cache par cette session. */
  readonly cacheCreation: number;
  /** Jetons relus depuis le cache par cette session. */
  readonly cacheRead: number;
  /** Millisecondes entre premier et dernier horodatage, `-1` sans horodatage. */
  readonly durationMs: number;
  readonly startedAt: string;
  readonly endedAt: string;
  /** Toujours `null` : aucune preuve de ticket dans ce flux (contrat §2). */
  readonly issueKey: string | null;
}

/** Le jeu de données tel que versionné dans le dépôt. */
export interface ClaudeCodeDataset {
  readonly generatedAt: string;
  readonly source: string;
  readonly sessions: readonly ClaudeCodeSession[];
}

/** Le client qui a exécuté la session (contrat §1). */
export const CLAUDE_CODE_CLIENT: Client = 'claude-code';

/** Le modèle qu'on ne connaît pas, dans le vocabulaire du contrat. */
export const MODELE_INCONNU: Modele = { provider: 'inconnu', id: 'inconnu' };

/** Marque du client pour une ligne fabriquée (erreur d'API) : ce n'est pas un modèle. */
export const VALEUR_NON_MODELE = '<synthetic>';

/** L'étiquette du modèle inconnu, comparée telle quelle dans les effectifs. */
const ETIQUETTE_INCONNUE = modelLabel(MODELE_INCONNU);

/** L'attribution de ces sessions : aucune preuve, donc aucune fenêtre (contrat §2). */
const ATTRIBUTION: Attribution = 'aucune';

/* ------------------------------------------------------------------ lecture */

function objetOuNull(valeur: unknown): Record<string, unknown> | null {
  return typeof valeur === 'object' && valeur !== null ? (valeur as Record<string, unknown>) : null;
}

function texte(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur : '';
}

/** Nombre lu dans le jeu : ce qui n'est pas un nombre fini est inconnu. */
function nombre(valeur: unknown): number {
  const brut = Number(valeur);
  return Number.isFinite(brut) ? Math.round(brut) : INCONNU;
}

/** Une valeur négative n'est pas une mesure : elle reste inconnue. */
function connu(valeur: number): number {
  return valeur >= 0 ? valeur : INCONNU;
}

/**
 * Somme des parties connues d'un volume de jetons. Une seule partie absente
 * rend l'ensemble inconnu : on n'additionne pas du `-1` à des mesures.
 */
function cumul(...valeurs: readonly number[]): number {
  if (valeurs.some((valeur) => valeur < 0)) return INCONNU;
  return valeurs.reduce((total, valeur) => total + valeur, 0);
}

/**
 * Le modèle d'une session, ramené au vocabulaire du contrat. `<synthetic>`
 * n'est pas un modèle — c'est la marque d'une ligne fabriquée par le client
 * (appel API raté) — donc un modèle inconnu, comme une valeur vide.
 */
export function normaliserModele(modele: ClaudeCodeModele): Modele {
  const id = texte(modele?.id).trim();
  const fournisseur = texte(modele?.provider).trim();
  if (id === '' || id === VALEUR_NON_MODELE) return MODELE_INCONNU;
  if (fournisseur !== '') return { provider: fournisseur, id };
  return /^claude-/i.test(id) ? { provider: 'anthropic', id } : { provider: 'inconnu', id };
}

/** Étiquette d'un modèle : `fournisseur/identifiant` (libellé commun, lot O1). */
export function etiquetteModele(modele: ClaudeCodeModele): string {
  return modelLabel(normaliserModele(modele));
}

/**
 * Les jetons d'entrée réellement consommés par le modèle : entrée fraîche,
 * cache créé et cache relu. Le contrat ne porte qu'un champ `jetonsEntree`,
 * donc les trois y passent — et le jeu versionné garde la distinction.
 */
export function entreeConsommee(session: ClaudeCodeSession): number {
  return cumul(session.tokensIn, session.cacheCreation, session.cacheRead);
}

/** Une session lue dans le jeu, refusée si elle n'a même pas de clé. */
function lireSession(valeur: unknown): ClaudeCodeSession {
  const objet = objetOuNull(valeur);
  if (!objet) throw new Error('jeu de données Claude Code illisible : session sans objet');
  const id = texte(objet['id']);
  if (id === '') throw new Error('jeu de données Claude Code illisible : session sans identifiant');
  const modele = objetOuNull(objet['model']) ?? { provider: '', id: '' };
  return {
    id,
    project: texte(objet['project']),
    branch: texte(objet['branch']),
    model: { provider: texte(modele['provider']), id: texte(modele['id']) },
    costEuros: nombre(objet['costEuros']),
    tokensIn: nombre(objet['tokensIn']),
    tokensOut: nombre(objet['tokensOut']),
    cacheCreation: nombre(objet['cacheCreation']),
    cacheRead: nombre(objet['cacheRead']),
    durationMs: nombre(objet['durationMs']),
    startedAt: texte(objet['startedAt']),
    endedAt: texte(objet['endedAt']),
    issueKey: null,
  };
}

/**
 * Lit le jeu versionné sans lui faire confiance : un contenu illisible est
 * REFUSÉ (une exception), pas silencieusement amputé. Une liste vide est
 * lisible : elle rend « rien n'est mesuré », pas une erreur.
 */
export function parseDatasetClaudeCode(brut: unknown): ClaudeCodeDataset {
  const objet = objetOuNull(brut);
  if (!objet) throw new Error('jeu de données Claude Code illisible : objet attendu');
  const sessionsBrutes = objet['sessions'];
  if (!Array.isArray(sessionsBrutes)) {
    throw new Error('jeu de données Claude Code illisible : `sessions` doit être une liste');
  }
  return {
    generatedAt: texte(objet['generatedAt']),
    source: texte(objet['source']),
    sessions: sessionsBrutes.map(lireSession),
  };
}

/* ------------------------------------------------------------ session unifiée */

/**
 * Une session Claude Code en session unifiée (contrat §1, §3).
 *
 * Ce que le flux ne dit pas reste `INCONNU` : le coût modèle (aucun prix
 * facturé), les diffs (aucun dans ce flux). Ce qu'il dit avec un zéro reste un
 * zéro : une session ratée a consommé zéro jeton, c'est mesuré.
 */
export function depuisClaudeCode(session: ClaudeCodeSession): SessionReelle {
  return {
    id: session.id,
    client: CLAUDE_CODE_CLIENT,
    projet: session.project,
    // aucun titre ni agent n'est exporté de ce flux : le dépôt est public, et
    // `agentName`/`customTitle` y sont du texte libre de conversation.
    titre: '',
    agent: '',
    modele: normaliserModele(session.model),
    coutEuros: connu(session.costEuros),
    jetonsEntree: entreeConsommee(session),
    jetonsSortie: connu(session.tokensOut),
    ajouts: INCONNU,
    suppressions: INCONNU,
    fichiersTouches: INCONNU,
    dureeMs: connu(session.durationMs),
    debut: session.startedAt,
    fin: session.endedAt,
    cleTicket: null,
    attribution: ATTRIBUTION,
  };
}

/* -------------------------------------------------------------------- résumé */

/** Le résumé du jeu versionné : des effectifs, jamais un taux nu. */
export interface ClaudeCodeResume {
  readonly sessions: number;
  readonly jetonsEntree: number;
  readonly jetonsSortie: number;
  readonly cacheLu: number;
  readonly cacheCree: number;
  readonly dureeMs: number;
  readonly modeles: readonly string[];
  readonly branches: readonly string[];
  readonly projets: readonly string[];
  readonly sansTimestamp: number;
  readonly sansModeleConnu: number;
  readonly avecTicket: number;
}

/** Les valeurs distinctes d'une liste, triées : un effectif, pas un taux. */
function distinctes(valeurs: readonly string[]): string[] {
  return [...new Set(valeurs.filter((valeur) => valeur !== ''))].sort();
}

/** Somme des seules valeurs mesurées : l'effectif manquant reste hors du total. */
function sommer(valeurs: readonly number[]): number {
  return valeurs.filter((valeur) => valeur >= 0).reduce((total, valeur) => total + valeur, 0);
}

/** Agrège le jeu réel : volumes, diversité et ce qui n'est pas mesuré. */
export function summariseClaudeCode(sessions: readonly ClaudeCodeSession[]): ClaudeCodeResume {
  return {
    sessions: sessions.length,
    jetonsEntree: sommer(sessions.map((session) => session.tokensIn)),
    jetonsSortie: sommer(sessions.map((session) => session.tokensOut)),
    cacheLu: sommer(sessions.map((session) => session.cacheRead)),
    cacheCree: sommer(sessions.map((session) => session.cacheCreation)),
    dureeMs: sommer(sessions.map((session) => session.durationMs)),
    modeles: distinctes(sessions.map((session) => etiquetteModele(session.model))),
    branches: distinctes(sessions.map((session) => session.branch)),
    projets: distinctes(sessions.map((session) => session.project)),
    sansTimestamp: sessions.filter((session) => session.startedAt === '').length,
    sansModeleConnu: sessions.filter((session) => etiquetteModele(session.model) === ETIQUETTE_INCONNUE).length,
    avecTicket: sessions.filter((session) => session.issueKey !== null).length,
  };
}
