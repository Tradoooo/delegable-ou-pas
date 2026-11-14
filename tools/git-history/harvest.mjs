#!/usr/bin/env node
/**
 * Récolte de l'historique d'un dépôt comme graphe réel (lot « graphe réel »).
 *
 * Ce script est le seul morceau qui touche au disque et au passé : il lit
 * `git log --numstat` du dépôt courant (HORS CI, jamais dans la suite de
 * tests), anonymise, trie et écrit un jeu de données versionnable dans
 * `src/sample/git-history-real.json`. Le domaine (`src/collect/git-history.ts`)
 * reste pur : il ne fait que transformer ce jeu en faits.
 *
 * Règles :
 *  - aucun nom d'auteur, aucun email, aucun chemin absolu, aucun login dans le
 *    fichier produit (le dépôt est public) ;
 *  - les identifiants de commit sont tronqués en préfixe court stable, assez
 *    long pour être unique dans le jeu récolté ;
 *  - le corps des commits n'est PAS versionné : seules les clés de ticket qui
 *    y figurent sont retenues, comme mention (un corps ne rattache rien) ;
 *  - même dépôt à même commit ⇒ même fichier : tri stable, `generatedAt`
 *    dérivé des données (jamais de l'horloge) ;
 *  - le mode par défaut ne fait AUCUN réseau. Les pull requests ne sont
 *    récoltées qu'avec `--prs` et un jeton présent ; sans elles, le champ vaut
 *    `null` (« non récolté »), jamais une liste vide (« récolté, zéro PR »).
 *
 * Usage :
 *   node tools/git-history/harvest.mjs [--repo <répertoire>] [--out <fichier>]
 *                                      [--prs] [--dry-run] [--help]
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SORTIE_DEFAUT = resolve(RACINE, 'src', 'sample', 'git-history-real.json');

/** Séparateurs de contrôle : enregistrement, champ, fin du corps. */
const SEP_RECORD = '\x1e';
const SEP_CHAMP = '\x1f';
const FIN_CORPS = '\x1d';
const FORMAT = [SEP_RECORD + '%H', '%aI', '%cI', '%P', '%s', '%b' + FIN_CORPS].join(SEP_CHAMP);

const MOTIF_NUMSTAT = /^(-|\d+)\t(-|\d+)\t(.+)$/;
const MOTIF_TICKET = /\bPROJ-\d+\b/g;
const MOTIF_COAUTEUR = /^Co-authored-by:/im;

/** Le catalogue de mots repérés comme signe d'un agent dans un sujet de commit. */
const CATALOGUE_AGENT = ['agent', 'automerge', 'fireworks', 'mergify'];

const LONGUEUR_TITRE = 200;
const MS_PAR_HEURE = 3_600_000;
const PAGE_PR = 100;
const PAGES_MAX = 20;

/* ------------------------------------------------------------------ filtres */

/**
 * Motifs qui ne doivent jamais atteindre le dépôt public : email, clé d'API,
 * jeton, empreinte longue, chemin absolu à deux segments au moins.
 */
const REGLE_NETTOYAGE = [
  { motif: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, nom: 'email' },
  { motif: /\bsk-[A-Za-z0-9_-]{16,}/g, nom: 'clé API' },
  { motif: /\bgh[pousr]_[A-Za-z0-9]{16,}/g, nom: 'jeton GitHub' },
  { motif: /\bgithub_pat_[A-Za-z0-9_]{16,}/g, nom: 'jeton GitHub' },
  { motif: /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/g, nom: 'en-tête Bearer' },
  { motif: /\b[0-9a-fA-F]{24,}\b/g, nom: 'empreinte' },
  { motif: /\b(?:ses|msg|prt|pt)_[A-Za-z0-9]{6,}/g, nom: 'identifiant de session' },
  { motif: /(?<![\w.-])(?:\/[A-Za-z0-9._~%-]+){2,}/g, nom: 'chemin absolu' },
];

/** Les mêmes motifs sans `g` : `test` ne doit pas garder d'état. */
const REGLE_VERIFICATION = REGLE_NETTOYAGE.map((r) => ({
  nom: r.nom,
  motif: new RegExp(r.motif.source, r.motif.flags.replace('g', '')),
}));

/** La place de ce qui ressemble à un secret ou à une donnée personnelle. */
const REMPLACEMENT = '[…]';

/* -------------------------------------------------------------------- util */

/** Exécute `git` dans `repo` et renvoie sa sortie standard. */
function git(repo, args) {
  const res = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (res.status !== 0) throw new Error(`git ${args[0]} a échoué : ${res.stderr ?? ''}`.trim());
  return res.stdout ?? '';
}

/** Vrai quand le texte porte encore une donnée personnelle (garde-fou final). */
function contientDonneePersonnelle(texte, logins) {
  if (REGLE_VERIFICATION.some((regle) => regle.motif.test(texte))) return true;
  return logins.some((login) => new RegExp(`\\b${echapper(login)}\\b`, 'gi').test(texte));
}

/** Échappe un texte pour l'utiliser dans une expression rationnelle. */
function echapper(texte) {
  return texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Nettoie un texte public : plus aucun email, aucune clé, aucun chemin
 * absolu, aucun login. Un texte qui résiste est remplacé en bloc.
 */
function nettoyer(texte, logins) {
  let resultat = String(texte ?? '');
  for (const regle of REGLE_NETTOYAGE) resultat = resultat.replace(regle.motif, REMPLACEMENT);
  for (const login of logins) {
    resultat = resultat.replace(new RegExp(`\\b${echapper(login)}\\b`, 'gi'), REMPLACEMENT);
  }
  resultat = resultat.replace(/\s+/g, ' ').trim();
  if (resultat.length > LONGUEUR_TITRE) resultat = `${resultat.slice(0, LONGUEUR_TITRE - 1).trimEnd()}…`;
  return contientDonneePersonnelle(resultat, logins) ? REMPLACEMENT : resultat;
}

/* ---------------------------------------------------------------- anonymat */

/** L'URL d'origine, ou `''` si le dépôt n'a pas de serveur distant. */
function origine(repo) {
  const res = spawnSync('git', ['-C', repo, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
  return res.status === 0 ? (res.stdout ?? '').trim() : '';
}

/**
 * Logins à effacer : celui du compte, celui de la machine, celui du dépôt et
 * ceux des auteurs rencontrés dans l'historique. Le dépôt est public : un nom
 * n'y a pas sa place (DP-17).
 */
function loginsAEffacer(repo) {
  const candidats = new Set([basename(homedir())]);
  for (const champ of ['user.name', 'user.email']) {
    const valeur = git(repo, ['config', '--get', champ]).trim();
    const local = champ === 'user.email' ? valeur.split('@')[0].trim() : valeur;
    if (local.length >= 4) candidats.add(local);
  }
  for (const ligne of git(repo, ['log', '--format=%an%x00%ae']).split('\n')) {
    const [nom, mail] = ligne.split('\0');
    if (nom && nom.length >= 4) candidats.add(nom.trim());
    const local = (mail ?? '').split('@')[0].trim();
    if (local.length >= 4) candidats.add(local);
  }
  const proprietaire = (origine(repo).match(/[:/]([^/:]+)\/[^/]+\.git$/) ?? [])[1];
  if (proprietaire && proprietaire.length >= 4) candidats.add(proprietaire);
  return [...candidats].filter((login) => login.length >= 4 && login !== '.' && login !== '/');
}

/** Nom du dépôt, relatif : le nom du répertoire commun, jamais un chemin. */
function nomDepot(repo) {
  const commun = git(repo, ['rev-parse', '--git-common-dir']).trim().replace(/\.git\/?$/, '');
  const nom = basename(resolve(repo, commun));
  return nom === '' || nom === '.' ? 'depot' : nom;
}

/* ------------------------------------------------------------------ ticket */

/** Les clés de ticket d'un texte, triées et sans doublon. */
function clefsTicket(texte) {
  return [...new Set(String(texte ?? '').match(MOTIF_TICKET) ?? [])].sort();
}

/** Les mots du catalogue présents dans un sujet, triés et sans doublon. */
function motsAgent(sujet) {
  const bas = String(sujet ?? '').toLowerCase();
  return CATALOGUE_AGENT.filter((mot) => bas.includes(mot)).sort();
}

/* -------------------------------------------------------------- construction */

/** Préfixe court stable : assez long pour être unique dans le jeu récolté. */
function longueurPrefixe(shas) {
  for (let longueur = 7; longueur <= 40; longueur += 1) {
    const prefixes = new Set(shas.map((sha) => sha.slice(0, longueur)));
    if (prefixes.size === shas.length) return longueur;
  }
  return 40;
}

/** Une entrée de numstat : lignes ajoutées, supprimées, chemin relatif. */
function lireEntree(ligne) {
  const trouve = MOTIF_NUMSTAT.exec(ligne);
  if (!trouve) return null;
  const [, ajouts, suppressions, chemin] = trouve;
  const binaire = ajouts === '-' || suppressions === '-';
  return {
    ajouts: binaire ? 0 : Number(ajouts),
    suppressions: binaire ? 0 : Number(suppressions),
    chemin,
    binaire,
  };
}

/** Découpe un enregistrement `git log` en champs, `null` si difforme. */
function scinder(chunk) {
  const [tete = '', queue = ''] = chunk.split(FIN_CORPS);
  const champs = tete.split(SEP_CHAMP);
  if (champs.length < 6 || !/^[0-9a-f]{40}$/.test(champs[0])) return null;
  const [sha, dateAuteur, dateCommit, parents, sujet, corps] = champs;
  return { sha, dateAuteur, dateCommit, parents, sujet, corps, queue };
}

/** Construit le commit public d'un enregistrement `git log`. */
function construireCommit(enregistrement, logins, longueur) {
  const morceaux = scinder(enregistrement);
  if (!morceaux) return null;
  const { sha, dateAuteur, dateCommit, parents, sujet, corps, queue } = morceaux;
  const entrees = queue.split('\n').map(lireEntree).filter((entree) => entree !== null);
  const ajouts = entrees.reduce((total, entree) => total + entree.ajouts, 0);
  const suppressions = entrees.reduce((total, entree) => total + entree.suppressions, 0);
  return {
    sha: sha.slice(0, longueur),
    dateAuteur: iso(dateAuteur),
    dateCommit: iso(dateCommit),
    parents: parents.trim() === '' ? 0 : parents.trim().split(/\s+/).length,
    titre: nettoyer(sujet, logins),
    ajouts,
    suppressions,
    fichiers: entrees.map((entree) => entree.chemin).sort(),
    lignesInconnues: entrees.some((entree) => entree.binaire),
    mentionAgent: motsAgent(sujet),
    cleTicket: clefsTicket(sujet)[0] ?? null,
    mentionTicket: clefsTicket(corps)[0] ?? null,
    coauteur: MOTIF_COAUTEUR.test(corps),
  };
}

/** ISO 8601 en UTC : une date git lisible par le domaine sans ambiguïté. */
function iso(dateGit) {
  const ms = Date.parse(String(dateGit ?? ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

/** Tri stable : date d'auteur puis identifiant, donc le fichier ne bouge pas. */
function trierCommits(commits) {
  return [...commits].sort((a, b) => (a.dateAuteur < b.dateAuteur ? -1 : a.dateAuteur > b.dateAuteur ? 1 : a.sha < b.sha ? -1 : 1));
}

/** Transformation complète de la sortie git : commits publics + agrégats. */
function transformer(sortie, repo, logins) {
  const bruts = sortie.split(SEP_RECORD).slice(1);
  const shas = bruts.map((chunk) => chunk.slice(0, 40)).filter((sha) => /^[0-9a-f]{40}$/.test(sha));
  const longueur = longueurPrefixe(shas);
  const commits = trierCommits(bruts.map((chunk) => construireCommit(chunk, logins, longueur)).filter(Boolean));
  const dernier = commits.reduce((max, commit) => Math.max(max, Date.parse(commit.dateCommit)), 0);
  return {
    generatedAt: new Date(dernier).toISOString(),
    source: 'git',
    depot: nomDepot(repo),
    longueurSha: longueur,
    coauteurs: commits.filter((commit) => commit.coauteur).length,
    catalogueAgent: [...CATALOGUE_AGENT].sort(),
    commits,
  };
}

/* ----------------------------------------------------------------------- PR */

/** Jeton d'API : l'environnement d'abord, puis `gh` si la machine l'a. */
function lireJeton() {
  const environnement = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
  if (environnement.trim() !== '') return environnement.trim();
  const res = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
  return res.status === 0 ? (res.stdout ?? '').trim() : '';
}

/** `proprietaire/depot` lu dans l'URL distante, `null` sans origine exploitable. */
function coordonneesDepot(repo) {
  const trouve = origine(repo).match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  return trouve ? `${trouve[1]}/${trouve[2]}` : null;
}

/** Une pull request publique : numéro, titre, branche, dates, sans auteur. */
function construirePr(brute, logins) {
  const ouverte = String(brute.created_at ?? '');
  const fusionnee = brute.merged_at ? String(brute.merged_at) : null;
  const duree = fusionnee ? Date.parse(fusionnee) - Date.parse(ouverte) : -1;
  const titre = nettoyer(String(brute.title ?? ''), logins);
  const branche = nettoyer(String(brute.head?.ref ?? ''), logins);
  const texte = `${titre} ${branche}`;
  return {
    numero: Number(brute.number ?? -1),
    titre,
    branche,
    ouverte: iso(ouverte),
    fusionnee: fusionnee ? iso(fusionnee) : null,
    dureeMs: duree >= 0 ? duree : -1,
    mentionAgent: motsAgent(texte).length > 0,
    cleTicket: clefsTicket(texte)[0] ?? null,
  };
}

/** Récolte les PR via l'API GitHub (HORS CI) ; `null` si rien n'a été récolté. */
async function recolterPrs(repo, jeton, logins) {
  const coordonnees = coordonneesDepot(repo);
  if (coordonnees === null || jeton === '') return null;
  const page = [];
  for (let numero = 1; numero <= PAGES_MAX; numero += 1) {
    const url = `https://api.github.com/repos/${coordonnees}/pulls?state=all&per_page=${PAGE_PR}&page=${numero}`;
    const res = await fetch(url, { headers: { Authorization: `bearer ${jeton}`, Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`API pull requests : ${res.status}`);
    const brut = await res.json();
    if (!Array.isArray(brut)) throw new Error('API pull requests : réponse inattendue');
    page.push(...brut.map((pr) => construirePr(pr, logins)));
    if (brut.length < PAGE_PR) break;
  }
  return page.sort((a, b) => a.numero - b.numero);
}

/* ------------------------------------------------------------- sérialisation */

/**
 * Garde d'anonymat finale, appliquée au fichier entier avant écriture : aucun
 * email, aucune clé, aucune empreinte longue, aucun chemin absolu, aucun login
 * rencontré dans le dépôt. Un échec ici arrête la récolte, il ne produit pas
 * un fichier « presque » anonyme.
 */
function verifierAnonymat(texte, logins) {
  const fautifs = [];
  for (const regle of REGLE_VERIFICATION) if (regle.motif.test(texte)) fautifs.push(regle.nom);
  for (const login of logins) {
    if (new RegExp(`\\b${echapper(login)}\\b`, 'i').test(texte)) fautifs.push(`login ${login}`);
  }
  if (fautifs.length > 0) throw new Error(`anonymat refusé : ${[...new Set(fautifs)].join(', ')}`);
}

/** Écrit le jeu : un commit par ligne, un scalar par ligne, diff lisible. */
function serialiser(jeu) {
  const lignes = (objets) => objets.map((objet) => `    ${JSON.stringify(objet)}`).join(',\n');
  const prs = jeu.pullRequests === null
    ? '  "pullRequests": null'
    : `  "pullRequests": [\n${lignes(jeu.pullRequests)}\n  ]`;
  return [
    '{',
    `  "generatedAt": ${JSON.stringify(jeu.generatedAt)},`,
    `  "source": ${JSON.stringify(jeu.source)},`,
    `  "depot": ${JSON.stringify(jeu.depot)},`,
    `  "longueurSha": ${jeu.longueurSha},`,
    `  "coauteurs": ${jeu.coauteurs},`,
    `  "catalogueAgent": ${JSON.stringify(jeu.catalogueAgent)},`,
    `  "recoltePrs": ${JSON.stringify(jeu.recoltePrs)},`,
    '  "commits": [',
    lignes(jeu.commits),
    '  ],',
    prs,
    '}',
    '',
  ].join('\n');
}

/* ------------------------------------------------------------------ résumé */

/** Médiane d'une liste triée : un chiffre sans moyenne (SPEC §6). */
function mediane(valeurs) {
  if (valeurs.length === 0) return null;
  const tries = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(tries.length / 2);
  return tries.length % 2 === 1 ? tries[milieu] : (tries[milieu - 1] + tries[milieu]) / 2;
}

/** Affiche le résumé réel : effectifs et fourchettes, jamais un chiffre nu. */
function afficherResume(jeu, ecrit) {
  const entrees = jeu.commits.reduce((total, commit) => total + commit.fichiers.length, 0);
  const distincts = new Set(jeu.commits.flatMap((commit) => commit.fichiers)).size;
  const mentions = jeu.commits.filter((commit) => commit.mentionAgent.length > 0).length;
  const liaisons = jeu.commits.filter((commit) => commit.cleTicket !== null).length;
  const prose = jeu.commits.filter((commit) => commit.mentionTicket !== null).length;
  const prs = jeu.pullRequests;
  console.log(`Récolte git — ${ecrit ? 'fichier écrit' : 'simulation (rien écrit)'}`);
  console.log(`  dépôt                : ${jeu.depot} (${jeu.commits.length} commit(s), préfixe ${jeu.longueurSha})`);
  console.log(`  entrées numstat      : ${entrees} — fichiers distincts : ${distincts}`);
  console.log(`  mentions d'agent     : ${mentions} commit(s) sur ${jeu.commits.length}`);
  console.log(`  liaisons de ticket   : ${liaisons} — mentions en prose : ${prose} — co-auteurs : ${jeu.coauteurs}`);
  if (prs === null) {
    console.log('  pull requests        : non récoltées (--prs absent ou jeton absent) → valeur inconnue, pas zéro');
  } else {
    const fusionnees = prs.filter((pr) => pr.fusionnee !== null);
    const heures = fusionnees.map((pr) => pr.dureeMs / MS_PAR_HEURE);
    const borne = (valeur) => (valeur === null ? 'n/d' : (Math.round(valeur * 100) / 100).toFixed(2));
    console.log(`  pull requests        : ${prs.length} dont ${fusionnees.length} fusionnée(s)`);
    console.log(`  ouverture→merge (h)  : médiane ${borne(mediane(heures))} [${borne(Math.min(...heures))} ; ${borne(Math.max(...heures))}]`);
  }
  console.log(`  horodatage retenu    : ${jeu.generatedAt}`);
}

/* --------------------------------------------------------------------- CLI */

/** Usage affiché sur demande. */
function usage() {
  return [
    'Récolte de l\u2019historique git d\u2019un dépôt comme graphe réel.',
    'Usage : node tools/git-history/harvest.mjs [options]',
    '  --repo <répertoire> dépôt à lire (défaut : celui de ce script)',
    '  --out <fichier>     jeu de données écrit (défaut : src/sample/git-history-real.json)',
    '  --prs               récolte aussi les pull requests via l\'API GitHub (exige un jeton)',
    '  --dry-run           affiche le résumé sans rien écrire',
    '  --help              cette aide',
  ].join('\n');
}

/** Analyse des arguments : options simples, sans dépendance. */
function analyserArgs(argv) {
  const options = { repo: RACINE, sortie: SORTIE_DEFAUT, prs: false, simulation: false, aide: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') options.repo = resolve(argv[++i] ?? '');
    else if (arg === '--out') options.sortie = resolve(argv[++i] ?? '');
    else if (arg === '--prs') options.prs = true;
    else if (arg === '--dry-run') options.simulation = true;
    else if (arg === '--help' || arg === '-h') options.aide = true;
    else throw new Error(`option inconnue : ${arg}`);
  }
  return options;
}

/** Point d'entrée : lecture git, anonymisation, PR optionnelles, écriture. */
async function main() {
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
  const logins = loginsAEffacer(options.repo);
  const sortie = git(options.repo, ['log', `--format=${FORMAT}`, '--numstat', '--no-color']);
  const jeu = transformer(sortie, options.repo, logins);
  const prs = options.prs ? await recolterPrs(options.repo, lireJeton(), logins) : null;
  const complet = { ...jeu, pullRequests: prs, recoltePrs: prs === null ? 'absente' : 'api-github' };
  if (options.simulation) {
    afficherResume(complet, false);
    return;
  }
  mkdirSync(dirname(options.sortie), { recursive: true });
  const texte = serialiser(complet);
  verifierAnonymat(texte, logins);
  writeFileSync(options.sortie, texte, 'utf8');
  afficherResume(complet, true);
  console.log(`  fichier            : ${options.sortie}`);
}

main().catch((err) => {
  console.error(`::error::récolte impossible : ${err.message}`);
  process.exit(1);
});
