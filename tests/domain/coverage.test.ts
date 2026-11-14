/**
 * Tests de la **couverture réelle** (lot « couverture réelle + qualité de la
 * donnée »). Module : `src/domain/coverage.ts`.
 *
 * Ce que le module mesure : sur le jeu réel versionné (`src/sample/
 * opencode-real.json`, 865 sessions), quelle part de la matière est rattachée
 * à un ticket — **25 sessions sur 865**, soit **2,89 %**, entre **1,97 %** et
 * **4,23 %** —, quelle part ne dit rien du code produit (**0 %**, entre 0 % et
 * 0,44 %), et comment la matière se répartit : **5 projets** (708 / 109 / 26 /
 * 20 / 2 sessions) et **20 modèles** (366 / 254 / 76 pour les trois premiers).
 *
 * Ce qu'il NE dit PAS, et c'est le cœur de la suite :
 *
 *  - il ne mesure **aucun bras humain** : `couvertureReelle` ne sait pas si un
 *    ticket a été tenu par une personne ou par un agent ;
 *  - il ne mesure **aucune issue** : rattachée à un ticket ne veut pas dire
 *    livrée, ni même acceptée ;
 *  - un diff **mesuré à zéro** n'est pas un diff **connu** : les 865 sessions
 *    du jeu portent `ajouts = 0`, `suppressions = 0`, `fichiersTouches = 0`
 *    parce que la base de collecte ne les porte pas, pas parce qu'aucun code
 *    n'a été produit. Le module rend donc **0 % d'« inconnu »** sur ce jeu —
 *    et ce 0 % là ne doit pas être lu comme « tous les diffs sont attribués » ;
 *  - une **liste vide** ne rend pas « 0 % » : elle rend `n = 0` avec
 *    `ciHigh = 1`, c'est-à-dire « rien n'est mesuré » (SPEC §20, recette 10).
 *
 * Aucun réseau, aucune base vivante : les chiffres viennent du fichier
 * versionné, la preuve en direct est dans `tools/prove-real.mjs`.
 * Aucune sortie par personne (DP-17, CONTRATS-REALITE §4.4) : le module ne
 * compte que des projets, des modèles et des tickets.
 *
 * Règle : fichiers < 500 lignes, fonctions < 50 lignes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDataset } from '../../src/collect/opencode.js';
import type { OpenCodeSession } from '../../src/collect/opencode.js';
import { couvertureReelle } from '../../src/domain/coverage.js';
import type { SessionCouvrable } from '../../src/domain/coverage.js';
import { etiquetteModele } from '../../src/domain/machine-cost.js';
import { proportion } from '../../src/domain/stats.js';

const JEU = fileURLToPath(new URL('../../src/sample/opencode-real.json', import.meta.url));

/** Les sessions réelles du jeu versionné. */
function sessionsReelles(): readonly OpenCodeSession[] {
  return parseDataset(JSON.parse(readFileSync(JEU, 'utf8'))).sessions;
}

/** Adapte une session de collecte au type que le domaine attend. */
function couvrable(session: OpenCodeSession): SessionCouvrable {
  return {
    projet: session.project,
    agent: session.agent,
    modele: { provider: session.model.provider, id: session.model.id },
    jetonsEntree: session.tokensIn,
    jetonsSortie: session.tokensOut,
    ajouts: session.additions,
    suppressions: session.deletions,
    fichiersTouches: session.filesTouched,
    dureeMs: session.durationMs,
    cleTicket: session.issueKey,
  };
}

/** Les sessions réelles, transposées pour le domaine. */
function jeuCouvrable(): readonly SessionCouvrable[] {
  return sessionsReelles().map(couvrable);
}

/** Une session construite : de quoi tordre un seul champ à la fois. */
function session(champs: Partial<SessionCouvrable> = {}): SessionCouvrable {
  return {
    projet: 'projet-a',
    agent: 'build',
    modele: { provider: 'opencode', id: 'space-bunny-free' },
    jetonsEntree: 10,
    jetonsSortie: 5,
    ajouts: 1,
    suppressions: 0,
    fichiersTouches: 1,
    dureeMs: 60_000,
    cleTicket: null,
    ...champs,
  };
}

describe('couverture réelle — le volume du jeu versionné', () => {
  it('compte 865 sessions : 25 rattachées à un ticket, 840 sans ticket', () => {
    const couverture = couvertureReelle(jeuCouvrable());
    expect(couverture.sessions).toBe(865);
    expect(couverture.avecTicket).toBe(25);
    expect(couverture.sansTicket).toBe(840);
    expect(couverture.avecTicket + couverture.sansTicket).toBe(couverture.sessions);
  });

  it('dit 2,89 % des sessions rattachées à un ticket, entre 1,97 % et 4,23 % sur 865', () => {
    const taux = couvertureReelle(jeuCouvrable()).tauxTicket;
    expect(taux).toEqual({
      n: 865,
      rate: 0.028901734104046242,
      ciLow: 0.019651787461894554,
      ciHigh: 0.042317621001051964,
    });
    // La part vient de `proportion()` du dépôt : la formule de Wilson n'est
    // pas réécrite dans le module (CONTRATS-REALITE §4.3).
    expect(taux).toEqual(proportion(25, 865));
  });

  it('rattache les 25 sessions à 5 clés de ticket, jamais à une personne', () => {
    const cles = jeuCouvrable()
      .map((une) => une.cleTicket)
      .filter((cle) => cle !== null) as string[];
    expect(cles.length).toBe(25);
    expect([...new Set(cles)].sort()).toEqual([
      'PROJ-101', 'PROJ-102', 'PROJ-103', 'PROJ-104', 'PROJ-105',
    ]);
    for (const cle of cles) expect(cle).toMatch(/^PROJ-\d+$/);
  });

  it('annonce 0 % de sessions au code produit inconnu, entre 0 % et 0,44 %', () => {
    const part = couvertureReelle(jeuCouvrable()).partInconnue;
    expect(part).toEqual({
      n: 865,
      rate: 0,
      ciLow: 0,
      ciHigh: 0.004421519411593551,
    });
    expect(part).toEqual(proportion(0, 865));
  });

  it('ne dit pas que les diffs sont connus : le jeu versionné les mesure à zéro', () => {
    // 865 sessions sur 865 portent `ajouts = suppressions = fichiersTouches = 0`
    // : un zéro **mesuré** par le collecteur, pas un diff attribué. Le 0 %
    // d'inconnu du test précédent vient de là, et de nulle part ailleurs.
    const zerosMesures = jeuCouvrable().filter(
      (une) => une.ajouts === 0 && une.suppressions === 0 && une.fichiersTouches === 0,
    );
    expect(zerosMesures.length).toBe(865);
    const inconnus = jeuCouvrable().filter((une) => une.ajouts === -1);
    expect(inconnus.length).toBe(0);
  });
});

describe('couverture réelle — la répartition', () => {
  it('répartit les 865 sessions sur 5 projets, du plus gros effectif au plus petit', () => {
    const parProjet = couvertureReelle(jeuCouvrable()).parProjet;
    expect(parProjet.map((part) => [part.cle, part.sessions])).toEqual([
      ['Bureau', 708],
      ['home', 109],
      ['Bureau/opencode-lab', 26],
      ['Bureau/cardwake', 20],
      ['Bureau/creux', 2],
    ]);
    expect(parProjet.reduce((total, part) => total + part.sessions, 0)).toBe(865);
    for (const part of parProjet) expect(part.part.n).toBe(865);
  });

  it('porte l’effectif et l’intervalle sur chaque part de projet', () => {
    const parProjet = couvertureReelle(jeuCouvrable()).parProjet;
    expect(parProjet[0]).toEqual({
      cle: 'Bureau',
      sessions: 708,
      part: {
        n: 865,
        rate: 0.8184971098265896,
        ciLow: 0.7914209459156756,
        ciHigh: 0.8427567914302343,
      },
    });
    expect(parProjet[4]).toEqual({
      cle: 'Bureau/creux',
      sessions: 2,
      part: {
        n: 865,
        rate: 0.0023121387283236996,
        ciLow: 0.0006342877223989452,
        ciHigh: 0.008391062813302845,
      },
    });
  });

  it('répartit les 865 sessions sur 20 modèles, 366 pour le premier', () => {
    const parModele = couvertureReelle(jeuCouvrable()).parModele;
    expect(parModele.length).toBe(20);
    expect(parModele.reduce((total, part) => total + part.sessions, 0)).toBe(865);
    expect(parModele.slice(0, 3).map((part) => [part.cle, part.sessions])).toEqual([
      ['opencode/space-bunny-free', 366],
      ['opencode/muse-spark-1.3-contributor-free', 254],
      ['modèle inconnu', 76],
    ]);
    expect(parModele[0].part.rate).toBe(0.423121387283237);
    expect(parModele[0].part.ciLow).toBe(0.3906076502424381);
    expect(parModele[0].part.ciHigh).toBe(0.45631496488096296);
  });

  it('nomme les modèles inconnus « modèle inconnu », jamais une chaîne vide', () => {
    const parModele = couvertureReelle(jeuCouvrable()).parModele;
    for (const part of parModele) expect(part.cle.length).toBeGreaterThan(0);
    expect(parModele.some((part) => part.cle === 'modèle inconnu')).toBe(true);
    expect(etiquetteModele({ provider: '', id: '' })).toBe('modèle inconnu');
  });
});

describe('couverture réelle — les cas limites', () => {
  it('sur une liste vide, ne mesure rien : n = 0 et ciHigh = 1, jamais un « 0 % » affirmé', () => {
    const vide = couvertureReelle([]);
    expect(vide.sessions).toBe(0);
    expect(vide.avecTicket).toBe(0);
    expect(vide.sansTicket).toBe(0);
    // « Rien n'est mesuré » : l'intervalle couvre tout [0, 1], donc le module
    // n'affirme ni 0 % ni 100 % (SPEC §20, recette 10).
    expect(vide.tauxTicket).toEqual({ n: 0, rate: 0, ciLow: 0, ciHigh: 1 });
    expect(vide.partInconnue).toEqual({ n: 0, rate: 0, ciLow: 0, ciHigh: 1 });
    expect(vide.parProjet).toEqual([]);
    expect(vide.parModele).toEqual([]);
  });

  it('compte l’inconnu (-1) à part, jamais comme un zéro mesuré', () => {
    // Une session au diff inconnu, une session au diff mesuré à zéro : le
    // module doit rendre 1 inconnue sur 2, pas 0 sur 2 ni 2 sur 2.
    const mixtes = [
      session({ ajouts: -1, suppressions: -1, fichiersTouches: -1 }),
      session({ ajouts: 0, suppressions: 0, fichiersTouches: 0 }),
    ];
    expect(couvertureReelle(mixtes).partInconnue).toEqual(proportion(1, 2));

    const zerosSeuls = [session({ ajouts: 0, suppressions: 0, fichiersTouches: 0 })];
    expect(couvertureReelle(zerosSeuls).partInconnue.rate).toBe(0);
    expect(couvertureReelle(zerosSeuls).partInconnue.n).toBe(1);
  });

  it('compte un seul champ à -1 comme un diff inconnu', () => {
    const unSeul = [session({ fichiersTouches: -1 })];
    expect(couvertureReelle(unSeul).partInconnue.rate).toBe(1);
    const deux = [session({ suppressions: -1 }), session({ ajouts: -1 })];
    expect(couvertureReelle(deux).partInconnue).toEqual(proportion(2, 2));
  });

  it('ordonne les parts par effectif décroissant puis par clé, quel que soit l’ordre d’arrivée', () => {
    // À effectif égal (2 et 2), c'est la clé qui tranche : 'projet-a' passe
    // avant 'projet-z' alors que 'projet-z' est arrivé le premier.
    const egalite = [
      session({ projet: 'projet-z', cleTicket: 'PROJ-1' }),
      session({ projet: 'projet-a' }),
      session({ projet: 'projet-z' }),
      session({ projet: 'projet-a' }),
    ];
    // À effectifs inégaux (3 et 1), le plus gros passe en premier.
    const inegalite = [
      session({ projet: 'petit' }),
      session({ projet: 'grand' }),
      session({ projet: 'grand' }),
      session({ projet: 'grand' }),
    ];
    const attendu = (liste: readonly SessionCouvrable[]): readonly string[] =>
      couvertureReelle(liste).parProjet.map((part) => part.cle);

    expect(attendu(egalite)).toEqual(['projet-a', 'projet-z']);
    expect(attendu([...egalite].reverse())).toEqual(['projet-a', 'projet-z']);
    expect(attendu(inegalite)).toEqual(['grand', 'petit']);
    expect(attendu([...inegalite].reverse())).toEqual(['grand', 'petit']);

    // Les effectifs suivent le même ordre que les clés.
    expect(couvertureReelle(egalite).parProjet.map((part) => part.sessions)).toEqual([2, 2]);
    expect(couvertureReelle(inegalite).parProjet.map((part) => part.sessions)).toEqual([3, 1]);
  });

  it('ne rend aucune sortie par personne (DP-17)', () => {
    const couverture = couvertureReelle(jeuCouvrable());
    const champs = Object.keys(couverture).sort();
    expect(champs).toEqual([
      'avecTicket', 'parModele', 'parProjet', 'partInconnue', 'sansTicket', 'sessions',
      'tauxTicket',
    ]);
    for (const champ of champs) {
      expect(champ).not.toMatch(/personne|utilisateur|auteur|owner|email|login/i);
    }
    // Chaque part est un projet ou un modèle : rien d'individuel n'y passe.
    const projets = new Set(jeuCouvrable().map((une) => une.projet));
    for (const part of couverture.parProjet) expect(projets.has(part.cle)).toBe(true);
    const modeles = new Set(jeuCouvrable().map((une) => etiquetteModele(une.modele)));
    for (const part of couverture.parModele) expect(modeles.has(part.cle)).toBe(true);
  });
});
