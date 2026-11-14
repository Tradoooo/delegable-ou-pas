/**
 * L'historique d'un dépôt comme **graphe réel** (CONTRATS-REALITE.md §3).
 *
 * Le dépôt s'analyse lui-même : ce module transforme le jeu versionné
 * `src/sample/git-history-real.json` (récolté HORS CI par
 * `tools/git-history/harvest.mjs`) en faits du domaine, dans le vocabulaire
 * gelé : `Client`, `Attribution`, `INCONNU = -1`. Quatre faits sortent de
 * l'historique, et rien de plus : les **diffs réels** par commit, la **durée
 * réelle entre commits** (un intervalle de dépôt, pas une durée de travail),
 * les **mentions d'agent** des sujets, le **rattachement ticket** marqué —
 * `'aucune'` quand rien ne rattache.
 *
 * Ce que l'historique NE DIT PAS (contrat §3 : « ne dit pas quelle session a
 * produit quel commit ») est rendu par `limitesGraphe()`, jamais effacé. Un
 * commit n'est pas une session : les champs qu'aucun git ne porte valent `-1`
 * — « on ne sait pas » — et non `0` — « mesuré, valait zéro ».
 *
 * Module PUR : ni `fs`, ni `spawn`, ni horloge, ni réseau. Règles : fichier
 * < 500 lignes, fonctions < 50 lignes, aucun chiffre sans effectif ni
 * fourchette — `proportion()` et `medianInterval()` de `src/domain/stats.ts`
 * se réutilisent tels quels, aucune formule n'est réimplémentée.
 */
import type { ProportionStat } from '../types.js';
import { medianInterval, proportion } from '../domain/stats.js';
import type { Attribution, Client, Modele, SessionReelle } from './session-reelle.js';
import { INCONNU } from './session-reelle.js';

/** Le client que l'historique peut nommer : aucun — un commit n'est pas une session. */
export const GRAPHE_CLIENT: Client = 'inconnu';

/** Le modèle que l'historique peut nommer : aucun champ ne le porte. */
export const GRAPHE_MODELE: Modele = { provider: '', id: '' };

/** Millisecondes par heure : une durée de dépôt se lit en heures (SPEC §6). */
const MS_PAR_HEURE = 3_600_000;

/** Un commit tel que versionné : ce que git a dit, rien de plus. */
export interface CommitGraphe {
  readonly sha: string;
  readonly dateAuteur: string;
  readonly dateCommit: string;
  readonly parents: number;
  readonly titre: string;
  readonly ajouts: number;
  readonly suppressions: number;
  /** Chemins relatifs, un par ligne de `numstat` (doublons compris). */
  readonly fichiers: readonly string[];
  /** Vrai quand un fichier binaire rend les lignes non comptables. */
  readonly lignesInconnues: boolean;
  /** Mots du catalogue de récolte présents dans le sujet. */
  readonly mentionAgent: readonly string[];
  /** Clé portée par le SUJET : une liaison. `null` sinon. */
  readonly cleTicket: string | null;
  /** Clé citée dans le CORPS : une mention en prose, qui ne rattache rien. */
  readonly mentionTicket: string | null;
  /** Vrai quand le message porte une ligne `Co-authored-by:`. */
  readonly coauteur: boolean;
}

/** Une pull request telle que versionnée (récolte optionnelle, hors CI). */
export interface PullRequestGraphe {
  readonly numero: number;
  readonly titre: string;
  readonly branche: string;
  readonly ouverte: string;
  readonly fusionnee: string | null;
  /** Ouverture→merge en millisecondes ; `-1` quand la PR n'est pas fusionnée. */
  readonly dureeMs: number;
  readonly mentionAgent: boolean;
  readonly cleTicket: string | null;
}

/** Le jeu versionné, tel que `harvest.mjs` l'écrit. */
export interface JeuGraphe {
  readonly generatedAt: string;
  readonly source: string;
  readonly depot: string;
  readonly longueurSha: number;
  readonly coauteurs: number;
  readonly catalogueAgent: readonly string[];
  readonly recoltePrs: string;
  readonly commits: readonly CommitGraphe[];
  /** `null` = PR non récoltées (« on ne sait pas »), `[]` = récolte sans PR. */
  readonly pullRequests: readonly PullRequestGraphe[] | null;
}

/* ------------------------------------------------------------------ lecture */

function objet(valeur: unknown): Record<string, unknown> | null {
  return typeof valeur === 'object' && valeur !== null ? (valeur as Record<string, unknown>) : null;
}
function texte(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur : '';
}
function entier(valeur: unknown): number {
  const nombre = Number(valeur);
  return Number.isFinite(nombre) ? Math.round(nombre) : INCONNU;
}
function booleen(valeur: unknown): boolean {
  return valeur === true;
}
function liste(valeur: unknown): readonly string[] {
  return Array.isArray(valeur) ? valeur.map((element) => texte(element)) : [];
}
/** Une clé lisible : le texte vide compte comme une absence (`null`). */
function cle(valeur: unknown): string | null {
  const chaine = texte(valeur).trim();
  return chaine === '' ? null : chaine;
}

/** Un commit lu dans le jeu ; `null` si l'enregistrement est inexploitable. */
function lireCommit(valeur: unknown): CommitGraphe | null {
  const objetBrut = objet(valeur);
  if (!objetBrut) return null;
  return {
    sha: texte(objetBrut.sha),
    dateAuteur: texte(objetBrut.dateAuteur),
    dateCommit: texte(objetBrut.dateCommit),
    parents: entier(objetBrut.parents),
    titre: texte(objetBrut.titre),
    ajouts: entier(objetBrut.ajouts),
    suppressions: entier(objetBrut.suppressions),
    fichiers: liste(objetBrut.fichiers),
    lignesInconnues: booleen(objetBrut.lignesInconnues),
    mentionAgent: liste(objetBrut.mentionAgent),
    cleTicket: cle(objetBrut.cleTicket),
    mentionTicket: cle(objetBrut.mentionTicket),
    coauteur: booleen(objetBrut.coauteur),
  };
}

/** Une pull request lue dans le jeu. */
function lirePr(valeur: unknown): PullRequestGraphe | null {
  const brut = objet(valeur);
  if (!brut) return null;
  return {
    numero: entier(brut.numero),
    titre: texte(brut.titre),
    branche: texte(brut.branche),
    ouverte: texte(brut.ouverte),
    fusionnee: cle(brut.fusionnee),
    dureeMs: entier(brut.dureeMs),
    mentionAgent: booleen(brut.mentionAgent),
    cleTicket: cle(brut.cleTicket),
  };
}

/**
 * Lit le jeu versionné sans lui faire confiance sur la forme : un
 * enregistrement illisible est ignoré, pas fatal. Une donnée absente reste
 * absente (contrat §1 : `-1`, jamais `0`).
 */
export function lireJeu(brut: unknown): JeuGraphe {
  const source = objet(brut);
  if (!source) throw new Error('jeu git illisible : objet attendu');
  const brutesPrs = source.pullRequests;
  const prs = Array.isArray(brutesPrs)
    ? brutesPrs.map(lirePr).filter((pr): pr is PullRequestGraphe => pr !== null)
    : null;
  const commitsBruts = source.commits;
  return {
    generatedAt: texte(source.generatedAt),
    source: texte(source.source),
    depot: texte(source.depot),
    longueurSha: entier(source.longueurSha),
    coauteurs: entier(source.coauteurs),
    catalogueAgent: liste(source.catalogueAgent),
    recoltePrs: texte(source.recoltePrs),
    commits: Array.isArray(commitsBruts)
      ? commitsBruts.map(lireCommit).filter((commit): commit is CommitGraphe => commit !== null)
      : [],
    pullRequests: prs,
  };
}

/** Ordre du dépôt : date d'auteur puis identifiant, indépendant de l'arrivée. */
function trierParDate(commits: readonly CommitGraphe[]): CommitGraphe[] {
  return [...commits].sort((a, b) => (a.dateAuteur < b.dateAuteur ? -1 : a.dateAuteur > b.dateAuteur ? 1 : a.sha < b.sha ? -1 : 1));
}

/** La seconde exacte d'une date du jeu ; `NaN` si la date est illisible. */
function instant(dateIso: string): number {
  const valeur = Date.parse(dateIso);
  return Number.isFinite(valeur) ? valeur : Number.NaN;
}

/* -------------------------------------------------------------------- diffs */

/** Le diff mesuré d'un commit, dans le vocabulaire du contrat. */
export interface DiffCommit {
  readonly sha: string;
  readonly ajouts: number;
  readonly suppressions: number;
  readonly fichiersTouches: number;
  /** Une ligne de `numstat` par fichier : 519 sur ce dépôt, 1 ici. */
  readonly entrees: number;
  /** Le diff est mesuré sur le commit lui-même : `'exacte'`, jamais une fenêtre. */
  readonly attribution: Attribution;
}

/** Vrai quand les lignes du commit sont comptables : ni fusion (aucun diff dans
 * `git log --numstat`), ni fichier binaire (aucune ligne). Donnée absente, pas nulle. */
function lignesComptables(commit: CommitGraphe): boolean {
  if (commit.lignesInconnues) return false;
  return !(commit.parents >= 2 && commit.fichiers.length === 0);
}

/** Le diff réel d'un commit : lignes et fichiers comptés par git lui-même. Ce qui
 * n'est pas comptable vaut `-1` ; le fichier touché reste compté. */
export function diffsCommit(commit: CommitGraphe): DiffCommit {
  const mesurable = lignesComptables(commit);
  return {
    sha: commit.sha,
    ajouts: mesurable ? commit.ajouts : INCONNU,
    suppressions: mesurable ? commit.suppressions : INCONNU,
    fichiersTouches: commit.fichiers.length,
    entrees: commit.fichiers.length,
    attribution: mesurable ? 'exacte' : 'aucune',
  };
}

/** Le résumé des diffs du jeu : totaux, effectifs, ce qui reste inconnu. */
export interface ResumeDiffs {
  readonly commits: number;
  readonly ajouts: number;
  readonly suppressions: number;
  readonly entreesNumstat: number;
  readonly fichiersDistincts: number;
  readonly commitsNonComptables: number;
}

/** Agrège les diffs réels du jeu. Une liste vide ne mesure rien (totaux 0, effectif 0). */
export function resumeDiffs(commits: readonly CommitGraphe[]): ResumeDiffs {
  const distincts = new Set<string>();
  let ajouts = 0;
  let suppressions = 0;
  let entrees = 0;
  let nonComptables = 0;
  for (const commit of commits) {
    const diff = diffsCommit(commit);
    if (diff.ajouts !== INCONNU) ajouts += diff.ajouts;
    if (diff.suppressions !== INCONNU) suppressions += diff.suppressions;
    if (diff.attribution === 'aucune') nonComptables += 1;
    entrees += diff.entrees;
    for (const chemin of commit.fichiers) distincts.add(chemin);
  }
  return {
    commits: commits.length,
    ajouts,
    suppressions,
    entreesNumstat: entrees,
    fichiersDistincts: distincts.size,
    commitsNonComptables: nonComptables,
  };
}

/** Les fichiers distincts du jeu, triés : la matière du graphe, chemin par chemin. */
export function fichiersDistincts(commits: readonly CommitGraphe[]): string[] {
  return [...new Set(commits.flatMap((commit) => commit.fichiers))].sort();
}

/* ------------------------------------------------------------------ durées */

/** La durée réelle entre commits du jeu, en heures, avec sa fourchette. */
export interface IntervallesCommits {
  /** Effectif des intervalles mesurés (commits - 1 quand tout est lisible). */
  readonly n: number;
  readonly medianeH: number;
  readonly ciLowH: number;
  readonly ciHighH: number;
  readonly minH: number;
  readonly maxH: number;
  /** Étendue du graphe, en heures : premier au dernier commit lisible. */
  readonly etendueH: number;
}

/** Durées entre commits consécutifs (ordre du dépôt, pas ordre d'arrivée). Rien
 * n'est mesuré sur une liste vide : valeurs `-1`, `n` `0`. Un intervalle de dépôt
 * n'est pas une durée de session — le contrat §3 le met hors du graphe. */
export function intervallesCommits(commits: readonly CommitGraphe[]): IntervallesCommits {
  const instants = trierParDate(commits).map((commit) => instant(commit.dateAuteur)).filter(Number.isFinite);
  const heures: number[] = [];
  for (let i = 1; i < instants.length; i += 1) heures.push((instants[i] - instants[i - 1]) / MS_PAR_HEURE);
  if (heures.length === 0) {
    return { n: 0, medianeH: INCONNU, ciLowH: INCONNU, ciHighH: INCONNU, minH: INCONNU, maxH: INCONNU, etendueH: INCONNU };
  }
  const intervalle = medianInterval(heures);
  const tries = [...heures].sort((a, b) => a - b);
  return {
    n: intervalle.n,
    medianeH: intervalle.medianH,
    ciLowH: intervalle.ciLow,
    ciHighH: intervalle.ciHigh,
    minH: tries[0],
    maxH: tries[tries.length - 1],
    etendueH: (instants[instants.length - 1] - instants[0]) / MS_PAR_HEURE,
  };
}

/* ---------------------------------------------------------- mentions d'agent */

/** Une mention relevée par mot du catalogue, avec son effectif. */
export interface MentionParMot {
  readonly mot: string;
  readonly commits: number;
}

/** Les mentions d'agent du jeu : effectif, répartition, et ce qui les fonde. */
export interface MentionsAgent {
  readonly part: ProportionStat;
  readonly commits: number;
  readonly parMot: readonly MentionParMot[];
  readonly coauteurs: number;
  readonly catalogue: readonly string[];
}

/** Les commits dont le sujet porte un mot du catalogue de récolte. La part est
 * rendue comme une proportion : effectif et intervalle compris. Sur une liste
 * vide, `proportion(0, 0)` rend `n = 0` et [0 ; 1] : rien n'est mesuré, aucun
 * « 0 % » n'est affirmé. */
export function mentionsAgent(commits: readonly CommitGraphe[], jeu: JeuGraphe): MentionsAgent {
  const parMot = new Map<string, number>();
  let avecMention = 0;
  for (const commit of commits) {
    if (commit.mentionAgent.length > 0) avecMention += 1;
    for (const mot of commit.mentionAgent) parMot.set(mot, (parMot.get(mot) ?? 0) + 1);
  }
  return {
    part: proportion(avecMention, commits.length),
    commits: avecMention,
    parMot: [...parMot.entries()]
      .map(([mot, commitsMot]) => ({ mot, commits: commitsMot }))
      .sort((a, b) => b.commits - a.commits || (a.mot < b.mot ? -1 : 1)),
    coauteurs: jeu.coauteurs,
    catalogue: jeu.catalogueAgent,
  };
}

/* --------------------------------------------------------- rattachement ticket */

/** Le rattachement ticket du graphe : liaisons comptées, mentions séparées. */
export interface RattachementTickets {
  readonly liaisons: ProportionStat;
  readonly mentionsProse: ProportionStat;
  readonly clefs: readonly string[];
  readonly attribution: Attribution;
}

/** Un rattachement ticket n'existe que si le message du commit le porte.
 * `attributionTicket` ne rend jamais `'fenetre'` : l'historique n'offre aucune
 * fenêtre sur une session, et une proximité de date n'est pas une preuve
 * (contrat §2). Sans clé dans le sujet, `'aucune'` — une conclusion. */
export function attributionTicket(commit: CommitGraphe): Attribution {
  return commit.cleTicket === null ? 'aucune' : 'exacte';
}

/** Compte les liaisons (sujet) et les mentions en prose (corps), sans les confondre. */
export function rattachementTickets(commits: readonly CommitGraphe[]): RattachementTickets {
  const clefs = new Set<string>();
  let liaisons = 0;
  let prose = 0;
  for (const commit of commits) {
    if (commit.cleTicket !== null) {
      liaisons += 1;
      clefs.add(commit.cleTicket);
    }
    if (commit.mentionTicket !== null) prose += 1;
  }
  return {
    liaisons: proportion(liaisons, commits.length),
    mentionsProse: proportion(prose, commits.length),
    clefs: [...clefs].sort(),
    attribution: liaisons > 0 ? 'exacte' : 'aucune',
  };
}

/* ------------------------------------------------------ session unifiée */

/** Le commit dans la forme du contrat §1. Tout ce qu'aucun git ne porte vaut
 * `-1` : coût, jetons, durée de travail, et surtout les lignes — le diff
 * appartient au commit, jamais à une session (contrat §3). `attribution` suit
 * le rattachement ticket. L'identifiant porte le préfixe court du commit, non
 * seize hexadécimaux : un commit n'est pas une session de client. */
export function sessionDepuisCommit(commit: CommitGraphe, jeu: JeuGraphe): SessionReelle {
  return {
    id: `${GRAPHE_CLIENT}_${commit.sha}`,
    client: GRAPHE_CLIENT,
    projet: jeu.depot,
    titre: commit.titre,
    agent: '',
    modele: GRAPHE_MODELE,
    coutEuros: INCONNU,
    jetonsEntree: INCONNU,
    jetonsSortie: INCONNU,
    ajouts: INCONNU,
    suppressions: INCONNU,
    fichiersTouches: INCONNU,
    dureeMs: INCONNU,
    debut: commit.dateAuteur,
    fin: commit.dateCommit,
    cleTicket: commit.cleTicket,
    attribution: attributionTicket(commit),
  };
}

/* ------------------------------------------------------------------------ PR */

/** Le résumé des pull requests, ou son absence explicite. */
export interface ResumePrs {
  readonly recoltee: boolean;
  readonly pullRequests: number;
  readonly fusionnees: number;
  readonly medianeH: number;
  readonly ciLowH: number;
  readonly ciHighH: number;
  readonly minH: number;
  readonly maxH: number;
  readonly mentionAgent: number;
  readonly cleTicket: ProportionStat;
}

/** Ouverture→merge des PR récoltées. Sans récolte, tout vaut `-1` : « on ne
 * sait pas » n'est pas « zéro PR » (contrat §1). Une PR non fusionnée ne porte
 * pas de durée et n'entre dans aucune médiane. */
export function resumePrs(jeu: JeuGraphe): ResumePrs {
  if (jeu.pullRequests === null) {
    return {
      recoltee: false, pullRequests: INCONNU, fusionnees: INCONNU, medianeH: INCONNU,
      ciLowH: INCONNU, ciHighH: INCONNU, minH: INCONNU, maxH: INCONNU,
      mentionAgent: INCONNU, cleTicket: proportion(0, 0),
    };
  }
  const prs = jeu.pullRequests;
  const heures = prs.filter((pr) => pr.fusionnee !== null && pr.dureeMs >= 0).map((pr) => pr.dureeMs / MS_PAR_HEURE);
  const intervalle = medianInterval(heures);
  const tries = [...heures].sort((a, b) => a - b);
  const avecCle = prs.filter((pr) => pr.cleTicket !== null).length;
  return {
    recoltee: true,
    pullRequests: prs.length,
    fusionnees: heures.length,
    medianeH: intervalle.medianH,
    ciLowH: intervalle.ciLow,
    ciHighH: intervalle.ciHigh,
    minH: tries.length > 0 ? tries[0] : INCONNU,
    maxH: tries.length > 0 ? tries[tries.length - 1] : INCONNU,
    mentionAgent: prs.filter((pr) => pr.mentionAgent).length,
    cleTicket: proportion(avecCle, prs.length),
  };
}

/* -------------------------------------------------------------------- limites */

/** Une limite mesurée du graphe : ce que l'historique NE dit pas. */
export interface LimiteGraphe {
  readonly code: string;
  readonly constat: string;
  readonly effectif: number;
  readonly total: number;
  readonly part: ProportionStat;
}

/** Une limite du graphe, toujours portée par son effectif. */
function limite(code: string, constat: string, effectif: number, total: number): LimiteGraphe {
  return { code, constat, effectif, total, part: proportion(effectif, total) };
}

/** Ce que l'historique ne dit pas, mesuré sur le jeu lui-même. Chaque limite
 * porte l'effectif qui la fonde : « aucune session rattachée » vaut 0 commit
 * sur 92, pas une impression. La liste est le reçu du lot. */
export function limitesGraphe(jeu: JeuGraphe): readonly LimiteGraphe[] {
  const commits = jeu.commits;
  const total = commits.length;
  const prs = jeu.pullRequests;
  const liaisons = commits.filter((commit) => commit.cleTicket !== null).length;
  const prose = commits.filter((commit) => commit.mentionTicket !== null).length;
  const reecrits = commits.filter((commit) => commit.dateAuteur !== commit.dateCommit).length;
  const fusions = commits.filter((commit) => commit.parents >= 2).length;
  const binaires = commits.filter((commit) => commit.lignesInconnues).length;
  return [
    limite('session-inconnue', 'aucun commit ne dit quelle session l’a produit (contrat §3)', total, total),
    limite('aucune-liaison', 'aucun sujet de commit ne porte de clé de ticket', liaisons, total),
    limite('mention-prose', 'des clés citées en prose dans le corps, qui ne rattachent rien', prose, total),
    limite('signature-absente', 'aucun commit ne porte de ligne Co-authored-by', jeu.coauteurs, total),
    limite('duree-inconnue', 'un commit ne porte aucune durée de travail', total, total),
    limite('cout-inconnu', 'l’historique ne porte ni coût ni jetons', total, total),
    limite('fusion-sans-diff', 'un commit de fusion ne porte pas de diff dans git log --numstat', fusions, total),
    limite('lignes-binaires', 'un fichier binaire ne donne pas de lignes comptables', binaires, total),
    limite('dates-reecrites', 'la date d’auteur diffère de la date de commit (rebase)', reecrits, total),
    limite('prs', prs === null
      ? 'pull requests non récoltées : la durée d’ouverture reste inconnue'
      : 'aucune pull request ne porte de clé de ticket',
    prs === null ? 0 : prs.filter((pr) => pr.cleTicket !== null).length,
    prs === null ? 0 : prs.length),
  ];
}
