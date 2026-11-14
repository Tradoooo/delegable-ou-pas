/**
 * Tests du graphe **réel** du dépôt (lot « graphe réel ») : les 92 commits,
 * 519 entrées de `numstat`, 403 fichiers distincts, 6 mentions d'agent et
 * **0 liaison de ticket** versionnés dans `src/sample/git-history-real.json`.
 *
 * Ce qui est mesuré : les diffs comptés par git lui-même (lignes, fichiers),
 * la durée réelle entre commits, les mentions d'agent relevées dans les
 * sujets, le rattachement ticket, et l'ouverture→merge des 111 pull requests
 * récoltées. Ce qui **n'est pas** mesuré, et que les tests disent comme tel :
 * quelle session a produit quel commit (contrat §3), la durée de travail d'un
 * commit, son coût, ses jetons, son modèle — tout cela vaut `-1`, jamais `0`.
 *
 * Aucun réseau, aucun `git` appelé, aucune base vivante : le test porte sur le
 * fichier versionné, comme `tests/collect/opencode-real.test.ts`. La récolte
 * est hors CI dans `tools/git-history/harvest.mjs`.
 *
 * Les cas limites sont **dérivés du jeu réel** (sous-liste, réordre, champ
 * retiré), jamais inventés : une fixture maison ne prouverait rien sur le
 * réel (contrat §4.5). Aucun chiffre sans effectif ni fourchette (§4.3) :
 * chaque part est un `proportion()`, chaque médiane un `medianInterval()`.
 *
 * Règles : fichier < 500 lignes, fonctions < 50 lignes, DP-17 (jamais par
 * personne).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  attributionTicket,
  diffsCommit,
  fichiersDistincts,
  intervallesCommits,
  limitesGraphe,
  lireJeu,
  mentionsAgent,
  rattachementTickets,
  resumeDiffs,
  resumePrs,
  sessionDepuisCommit,
} from '../../src/collect/git-history.js';
import type { CommitGraphe, JeuGraphe } from '../../src/collect/git-history.js';
import { GRAPHE_CLIENT } from '../../src/collect/git-history.js';
import { INCONNU, ticketsDistincts } from '../../src/collect/session-reelle.js';

const JEU = fileURLToPath(new URL('../../src/sample/git-history-real.json', import.meta.url));

/** Arrondi à six décimales : une comparaison de flottant reste une égalité lisible. */
function arret(valeur: number): number {
  return Math.round(valeur * 1e6) / 1e6;
}

/** Le jeu versionné, lu tel quel. */
function jeuReel(): JeuGraphe {
  return lireJeu(JSON.parse(readFileSync(JEU, 'utf8')));
}

/** Les commits réels du jeu versionné. */
function commitsReels(): readonly CommitGraphe[] {
  return jeuReel().commits;
}

/** Un commit réel, privé d'une donnée : la façon la plus honnête de tester `-1`. */
function sansDonnee(commit: CommitGraphe, champ: 'lignesInconnues'): CommitGraphe {
  return { ...commit, [champ]: true };
}

describe('jeu versionné — la matière du graphe', () => {
  it('porte 92 commits, 519 entrées de numstat et 403 fichiers distincts', () => {
    const diffs = resumeDiffs(commitsReels());
    expect(diffs.commits).toBe(92);
    expect(diffs.entreesNumstat).toBe(519);
    expect(diffs.fichiersDistincts).toBe(403);
    expect(fichiersDistincts(commitsReels())).toHaveLength(403);
    expect(diffs.commitsNonComptables).toBe(0);
  });

  it('compte 99 092 lignes ajoutées et 2 098 supprimées, mesurées par git', () => {
    const diffs = resumeDiffs(commitsReels());
    expect(diffs.ajouts).toBe(99_092);
    expect(diffs.suppressions).toBe(2_098);
  });

  it('versionne le dépôt sous un nom relatif et des identifiants tronqués', () => {
    const jeu = jeuReel();
    expect(jeu.depot).toBe('delegable-ou-pas');
    expect(jeu.depot.startsWith('/')).toBe(false);
    expect(jeu.longueurSha).toBe(7);
    expect(jeu.generatedAt).toBe('2026-11-14T13:42:25.000Z');
    expect(jeu.recoltePrs).toBe('api-github');
    const shas = jeu.commits.map((commit) => commit.sha);
    expect(new Set(shas).size).toBe(shas.length);
    for (const sha of shas) expect(sha).toMatch(/^[0-9a-f]{7}$/);
  });
});

describe('diffs réels — par commit', () => {
  it('mesure un diff sur chacun des 92 commits, attribution « exacte »', () => {
    for (const commit of commitsReels()) {
      const diff = diffsCommit(commit);
      expect(diff.attribution).toBe('exacte');
      expect(diff.fichiersTouches).toBeGreaterThanOrEqual(1);
      expect(diff.entrees).toBe(commit.fichiers.length);
      expect(diff.ajouts).toBeGreaterThanOrEqual(0);
      expect(diff.suppressions).toBeGreaterThanOrEqual(0);
    }
  });

  it('porte le plus gros commit à 30 649 lignes ajoutées', () => {
    const gros = commitsReels().reduce((a, b) => (b.ajouts > a.ajouts ? b : a));
    expect(gros.sha).toBe('d049126');
    expect(gros.ajouts).toBe(30_649);
  });

  it('rend `-1` et non `0` quand les lignes ne sont pas comptables', () => {
    const commit = commitsReels()[0];
    const diff = diffsCommit(sansDonnee(commit, 'lignesInconnues'));
    expect(diff.ajouts).toBe(INCONNU);
    expect(diff.suppressions).toBe(INCONNU);
    expect(diff.attribution).toBe('aucune');
    expect(diff.fichiersTouches).toBe(commit.fichiers.length);
  });

  it('rend `-1` sur un commit de fusion dérivé du jeu : aucun diff dans numstat', () => {
    const fusion = { ...commitsReels()[0], parents: 2, fichiers: [], ajouts: 0, suppressions: 0 };
    const diff = diffsCommit(fusion);
    expect(diff.ajouts).toBe(INCONNU);
    expect(diff.fichiersTouches).toBe(0);
    expect(diff.attribution).toBe('aucune');
    expect(resumeDiffs([fusion]).commitsNonComptables).toBe(1);
  });

  it('marque « exacte » la seule liaison déclarée : la marque suit la preuve', () => {
    const reel = commitsReels()[0];
    const declare = { ...reel, cleTicket: 'PROJ-999' };
    expect(attributionTicket(declare)).toBe('exacte');
    expect(attributionTicket(reel)).toBe('aucune');
    const tickets = rattachementTickets([declare, reel]);
    expect(tickets.liaisons.n).toBe(2);
    expect(tickets.liaisons.rate).toBe(0.5);
    expect(tickets.clefs).toEqual(['PROJ-999']);
    expect(tickets.attribution).toBe('exacte');
  });
});

describe('durée réelle — entre commits', () => {
  it('mesure 91 intervalles, médiane 0,284 h encadrée [0,163 ; 0,431]', () => {
    const intervalles = intervallesCommits(commitsReels());
    expect(intervalles.n).toBe(91);
    expect(arret(intervalles.medianeH)).toBe(0.284167);
    expect(arret(intervalles.ciLowH)).toBe(0.162778);
    expect(arret(intervalles.ciHighH)).toBe(0.430833);
  });

  it('tient sur 71,30 heures : trois jours d’histoire, pas douze mois', () => {
    const intervalles = intervallesCommits(commitsReels());
    expect(arret(intervalles.etendueH)).toBe(71.298333);
    expect(arret(intervalles.minH)).toBe(0.000556);
    expect(arret(intervalles.maxH)).toBe(16.270833);
  });

  it('ne dépend pas de l’ordre d’arrivée des commits', () => {
    const droite = intervallesCommits(commitsReels());
    const inversee = intervallesCommits([...commitsReels()].reverse());
    expect(arret(inversee.medianeH)).toBe(arret(droite.medianeH));
    expect(inversee.n).toBe(droite.n);
    expect(resumeDiffs([...commitsReels()].reverse())).toEqual(resumeDiffs(commitsReels()));
  });

  it('ne mesure rien sur une liste vide : `-1`, jamais un 0 affirmé', () => {
    const vide = intervallesCommits(commitsReels().slice(0, 0));
    expect(vide.n).toBe(0);
    expect(vide.medianeH).toBe(INCONNU);
    expect(vide.minH).toBe(INCONNU);
    expect(vide.maxH).toBe(INCONNU);
    expect(vide.etendueH).toBe(INCONNU);
  });
});

describe('mentions d’agent — relevées dans les sujets', () => {
  it('relève 6 commits sur 92, soit 6,5 % [3,0 ; 13,5]', () => {
    const mentions = mentionsAgent(commitsReels(), jeuReel());
    expect(mentions.commits).toBe(6);
    expect(mentions.part.n).toBe(92);
    expect(arret(mentions.part.rate)).toBe(0.065217);
    expect(arret(mentions.part.ciLow)).toBe(0.03023);
    expect(arret(mentions.part.ciHigh)).toBe(0.13506);
  });

  it('répartit les 6 mentions entre « agent » (3) et « mergify » (3)', () => {
    const mentions = mentionsAgent(commitsReels(), jeuReel());
    expect(mentions.parMot).toEqual([
      { mot: 'agent', commits: 3 },
      { mot: 'mergify', commits: 3 },
    ]);
    expect(mentions.catalogue).toEqual(['agent', 'automerge', 'fireworks', 'mergify']);
  });

  it('compte 0 ligne Co-authored-by : la signature d’agent est absente du dépôt', () => {
    const mentions = mentionsAgent(commitsReels(), jeuReel());
    expect(mentions.coauteurs).toBe(0);
    expect(commitsReels().filter((commit) => commit.coauteur)).toHaveLength(0);
  });

  it('ne affirme aucun pourcentage sur une liste vide : intervalle [0 ; 1]', () => {
    const mentions = mentionsAgent(commitsReels().slice(0, 0), jeuReel());
    expect(mentions.commits).toBe(0);
    expect(mentions.part.n).toBe(0);
    expect(mentions.part.ciLow).toBe(0);
    expect(mentions.part.ciHigh).toBe(1);
  });
});

describe('rattachement ticket — le 0 qui fonde le lot', () => {
  it('ne trouve AUCUNE liaison de ticket : 0 commit sur 92', () => {
    const tickets = rattachementTickets(commitsReels());
    expect(tickets.liaisons.rate).toBe(0);
    expect(tickets.clefs).toEqual([]);
    expect(tickets.attribution).toBe('aucune');
    expect(arret(tickets.liaisons.ciHigh)).toBe(0.040083);
  });

  it('marque « aucune » les 92 commits, sans jamais inventer une fenêtre', () => {
    for (const commit of commitsReels()) {
      expect(commit.cleTicket).toBeNull();
      expect(attributionTicket(commit)).toBe('aucune');
      expect(attributionTicket(commit)).not.toBe('fenetre');
    }
  });

  it('sépare les 7 mentions en prose d’une liaison : citer un ticket ne le rattache pas', () => {
    const tickets = rattachementTickets(commitsReels());
    expect(tickets.mentionsProse.n).toBe(92);
    expect(arret(tickets.mentionsProse.rate)).toBe(0.076087);
    expect(arret(tickets.mentionsProse.ciLow)).toBe(0.037343);
    expect(arret(tickets.mentionsProse.ciHigh)).toBe(0.148814);
    const cles = [...new Set(commitsReels().map((commit) => commit.mentionTicket).filter(Boolean))].sort();
    expect(cles).toEqual(['PROJ-207', 'PROJ-412']);
  });
});

describe('pull requests — la récolte versionnée', () => {
  it('porte 111 PR dont 68 fusionnées, 0 avec une clé de ticket', () => {
    const prs = resumePrs(jeuReel());
    expect(prs.recoltee).toBe(true);
    expect(prs.pullRequests).toBe(111);
    expect(prs.fusionnees).toBe(68);
    expect(prs.mentionAgent).toBe(48);
    expect(prs.cleTicket.rate).toBe(0);
    expect(prs.cleTicket.n).toBe(111);
  });

  it('mesure l’ouverture→merge : médiane 0,196 h [0,064 ; 0,300]', () => {
    const prs = resumePrs(jeuReel());
    expect(arret(prs.medianeH)).toBe(0.196389);
    expect(arret(prs.ciLowH)).toBe(0.064167);
    expect(arret(prs.ciHighH)).toBe(0.300278);
    expect(arret(prs.minH)).toBe(0.015556);
    expect(arret(prs.maxH)).toBe(21.190833);
  });

  it('rend `-1` partout quand la récolte est absente, jamais un zéro de PR', () => {
    const jeu = jeuReel();
    const prs = resumePrs({ ...jeu, pullRequests: null, recoltePrs: 'absente' });
    expect(prs.recoltee).toBe(false);
    expect(prs.pullRequests).toBe(INCONNU);
    expect(prs.fusionnees).toBe(INCONNU);
    expect(prs.medianeH).toBe(INCONNU);
    expect(prs.mentionAgent).toBe(INCONNU);
    expect(prs.cleTicket.n).toBe(0);
  });
});

describe('session unifiée — le commit dans le vocabulaire du contrat', () => {
  it('donne à chaque commit le client « inconnu » et l’attribution « aucune »', () => {
    const jeu = jeuReel();
    for (const commit of jeu.commits) {
      const session = sessionDepuisCommit(commit, jeu);
      expect(session.client).toBe(GRAPHE_CLIENT);
      expect(session.client).toBe('inconnu');
      expect(session.attribution).toBe('aucune');
      expect(session.projet).toBe(jeu.depot);
      expect(session.debut).toBe(commit.dateAuteur);
      expect(session.fin).toBe(commit.dateCommit);
    }
  });

  it('laisse `-1` sur tout ce qu’aucun git ne porte : coût, jetons, lignes, durée', () => {
    const session = sessionDepuisCommit(commitsReels()[0], jeuReel());
    expect(session.coutEuros).toBe(INCONNU);
    expect(session.jetonsEntree).toBe(INCONNU);
    expect(session.jetonsSortie).toBe(INCONNU);
    expect(session.ajouts).toBe(INCONNU);
    expect(session.suppressions).toBe(INCONNU);
    expect(session.fichiersTouches).toBe(INCONNU);
    expect(session.dureeMs).toBe(INCONNU);
    expect(session.modele).toEqual({ provider: '', id: '' });
  });

  it('fonde aucune cohorte : les 92 sessions réelles ne visent aucun ticket', () => {
    const jeu = jeuReel();
    const sessions = jeu.commits.map((commit) => sessionDepuisCommit(commit, jeu));
    expect(sessions).toHaveLength(92);
    expect(ticketsDistincts(sessions)).toEqual([]);
  });
});

describe('limites du graphe — ce que l’historique ne dit pas', () => {
  it('énonce 10 limites, chacune portée par son effectif', () => {
    const limites = limitesGraphe(jeuReel());
    expect(limites).toHaveLength(10);
    for (const limite of limites) {
      expect(limite.code.length).toBeGreaterThan(0);
      expect(limite.constat.length).toBeGreaterThan(0);
      expect(limite.part.n).toBe(limite.total);
      expect(limite.effectif).toBeLessThanOrEqual(limite.total);
    }
  });

  it('dit « aucune session » sur 92 commits et « aucune liaison » sur 0', () => {
    const limites = limitesGraphe(jeuReel());
    const parCode = new Map(limites.map((limite) => [limite.code, limite]));
    expect(parCode.get('session-inconnue')?.effectif).toBe(92);
    expect(parCode.get('aucune-liaison')?.effectif).toBe(0);
    expect(parCode.get('aucune-liaison')?.total).toBe(92);
    expect(parCode.get('signature-absente')?.effectif).toBe(0);
    expect(parCode.get('dates-reecrites')?.effectif).toBe(91);
    expect(parCode.get('fusion-sans-diff')?.effectif).toBe(0);
    expect(parCode.get('lignes-binaires')?.effectif).toBe(0);
  });

  it('ne masque pas la limite des pull requests non récoltées', () => {
    const jeu = jeuReel();
    const limites = limitesGraphe({ ...jeu, pullRequests: null });
    const prs = limites.find((limite) => limite.code === 'prs');
    expect(prs?.total).toBe(0);
    expect(prs?.part.ciHigh).toBe(1);
    expect(prs?.constat).toContain('non récoltées');
  });
});

describe('DP-17 — aucune sortie par personne', () => {
  it('ne laisse fuir aucun email, aucun chemin absolu dans le jeu versionné', () => {
    const brut = readFileSync(JEU, 'utf8');
    expect(brut).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(brut).not.toMatch(/"(?:\/[A-Za-z0-9._~%-]+){2,}"/);
    expect(brut).not.toMatch(/\b[a-f0-9]{40}\b/);
  });

  it('ne porte aucun champ nominatif, ni dans le jeu ni dans les sorties', () => {
    const brut = readFileSync(JEU, 'utf8');
    for (const champ of ['auteur', 'author', 'login', 'email', 'compte', 'utilisateur']) {
      expect(brut).not.toMatch(new RegExp(`"${champ}"`, 'i'));
    }
    const jeu = jeuReel();
    expect(Object.keys(jeu.commits[0])).not.toContain('auteur');
    expect(Object.keys(diffsCommit(jeu.commits[0]))).toEqual([
      'sha', 'ajouts', 'suppressions', 'fichiersTouches', 'entrees', 'attribution',
    ]);
    expect(Object.keys(sessionDepuisCommit(jeu.commits[0], jeu)).map((cle) => cle.toLowerCase())).not.toContain('auteur');
  });
});
