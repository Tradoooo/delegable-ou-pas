/**
 * Tests de la **qualité de la donnée** (lot « couverture réelle + qualité de
 * la donnée »). Module : `src/domain/data-quality.ts`.
 *
 * Ce que le module mesure : sur le jeu réel versionné (`src/sample/
 * opencode-real.json`, 865 sessions), quelles sessions portent une lacune —
 * **76 sans agent**, **97 sans jetons**, **3 de durée nulle**, **23 de plus de
 * 12 h**, **0 au diff inconnu** — et ce qu'il reste de matière intacte :
 * **745 sessions saines sur 865**, soit **86,13 %**, entre **83,66 %** et
 * **88,27 %**. Sous le seuil documenté de 90 %, donc le verdict est
 * **à manier avec prudence**.
 *
 * Ce qu'il NE dit PAS, et c'est le cœur de la suite :
 *
 *  - une anomalie n'est **pas une partition** : une session peut en porter
 *     plusieurs. Sur le jeu réel, les effectifs somment à **199 lignes
 *     d'anomalie pour 120 sessions atteintes** — additionner les anomalies
 *     pour obtenir « la part de matière sale » serait un mensonge ;
 *  - un diff **inconnu (`-1`**) n'est pas un diff **mesuré à zéro** : les 865
 *    sessions du jeu portent des diffs à 0, le module rend donc
 *    `diffs-inconnus = 0`, et ce 0 veut dire « le collecteur a écrit zéro »,
 *    jamais « tous les diffs sont attribués » ;
 *  - le verdict se lit sur l'**estimation ponctuelle** de la part saine, pas
 *    sur sa borne haute : à 8 sessions saines sur 10, l'intervalle monte à
 *    94,33 % — au-dessus du seuil — et la matière reste à manier avec prudence ;
 *  - une liste vide ne rend **jamais** une matière « exploitable par défaut » :
 *    rien n'est mesuré, donc rien n'est exploitable (SPEC §20).
 *
 * Aucun réseau, aucune base vivante : les chiffres viennent du fichier
 * versionné. Aucune sortie par personne (DP-17, CONTRATS-REALITE §4.4) : le
 * module compte des lacunes, pas des auteurs.
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
import {
  ANOMALIES,
  DUREE_ABERRANTE_H,
  PART_MIN_SAINES,
  qualiteDonnee,
} from '../../src/domain/data-quality.js';
import type { CodeAnomalie } from '../../src/domain/data-quality.js';
import { proportion } from '../../src/domain/stats.js';

const JEU = fileURLToPath(new URL('../../src/sample/opencode-real.json', import.meta.url));

/** Une heure en millisecondes. */
const MS_PAR_HEURE = 3_600_000;

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

/** Les sessions réelles du jeu versionné, transposées pour le domaine. */
function jeuCouvrable(): readonly SessionCouvrable[] {
  return parseDataset(JSON.parse(readFileSync(JEU, 'utf8'))).sessions.map(couvrable);
}

/** Une session construite, saine par défaut : on ne tord que le champ testé. */
function sessionSaine(champs: Partial<SessionCouvrable> = {}): SessionCouvrable {
  return {
    projet: 'projet',
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

/** Les codes d'anomalie d'une session, lus à travers le module lui-même. */
function codesPortes(session: SessionCouvrable): readonly CodeAnomalie[] {
  return qualiteDonnee([session]).anomalies
    .filter((anomalie) => anomalie.effectif > 0)
    .map((anomalie) => anomalie.code);
}

describe('qualité de la donnée — le verdict sur le jeu versionné', () => {
  it('juge la matière réelle à manier avec prudence : 745 sessions saines sur 865', () => {
    const qualite = qualiteDonnee(jeuCouvrable());
    expect(qualite.sessions).toBe(865);
    expect(qualite.saines).toBe(745);
    expect(qualite.verdict).toBe('a-manier-avec-prudence');
  });

  it('donne 86,13 % de sessions saines, entre 83,66 % et 88,27 %, sous le seuil de 90 %', () => {
    const part = qualiteDonnee(jeuCouvrable()).partSaines;
    expect(part).toEqual({
      n: 865,
      rate: 0.861271676300578,
      ciLow: 0.836634189317366,
      ciHigh: 0.882714423824546,
    });
    expect(part).toEqual(proportion(745, 865));
    // Toute la fourchette reste sous le seuil : le verdict n'est pas un artefact
    // d'arrondi, il tient même à la borne haute.
    expect(PART_MIN_SAINES).toBe(0.9);
    expect(part.ciHigh).toBeLessThan(PART_MIN_SAINES);
  });

  it('compte 76 sans agent, 97 sans jetons, 3 de durée nulle, 23 de plus de 12 h, 0 de diff inconnu', () => {
    const qualite = qualiteDonnee(jeuCouvrable());
    expect(qualite.anomalies.map((anomalie) => [anomalie.code, anomalie.effectif])).toEqual([
      ['sans-agent', 76],
      ['sans-jetons', 97],
      ['duree-nulle', 3],
      ['duree-aberrante', 23],
      ['diffs-inconnus', 0],
    ]);
    for (const anomalie of qualite.anomalies) expect(anomalie.taux.n).toBe(865);
    expect(qualite.anomalies[0].taux).toEqual({
      n: 865, rate: 0.08786127167630058, ciLow: 0.07077142147387266, ciHigh: 0.1085956806538339,
    });
    expect(qualite.anomalies[1].taux).toEqual({
      n: 865, rate: 0.11213872832369942, ciLow: 0.09280221448931343, ciHigh: 0.1349051144415296,
    });
    expect(qualite.anomalies[2].taux).toEqual({
      n: 865, rate: 0.003468208092485549, ciLow: 0.001180168312589643, ciHigh: 0.010147097785166266,
    });
    expect(qualite.anomalies[3].taux).toEqual({
      n: 865, rate: 0.026589595375722544, ciLow: 0.017782246162854037, ciHigh: 0.03958333117598425,
    });
    expect(qualite.anomalies[4].taux).toEqual({
      n: 865, rate: 0, ciLow: 0, ciHigh: 0.004421519411593551,
    });
  });

  it('rend les cinq anomalies dans l’ordre figé du contrat, y compris à effectif nul', () => {
    expect(ANOMALIES).toEqual([
      'sans-agent', 'sans-jetons', 'duree-nulle', 'duree-aberrante', 'diffs-inconnus',
    ]);
    // `diffs-inconnus` vaut 0 sur le jeu : la ligne est quand même rendue, dans
    // le même ordre — une lacune absente se déclare, elle ne disparaît pas.
    const qualite = qualiteDonnee(jeuCouvrable());
    expect(qualite.anomalies.map((anomalie) => anomalie.code)).toEqual(ANOMALIES);
    expect(qualiteDonnee([sessionSaine()]).anomalies.map((a) => a.code)).toEqual(ANOMALIES);
  });

  it('laisse une session porter plusieurs anomalies : 199 lignes pour 120 sessions atteintes', () => {
    const qualite = qualiteDonnee(jeuCouvrable());
    const somme = qualite.anomalies.reduce((total, a) => total + a.effectif, 0);
    expect(somme).toBe(199);
    expect(qualite.sessions - qualite.saines).toBe(120);
    expect(somme).toBeGreaterThan(120);
    // 76 sessions portent deux lacunes ou plus ; les combinaisons réelles :
    // 745 intactes, 73 « sans agent + sans jetons », 23 « durée aberrante »,
    // 21 « sans jetons », 3 « sans agent + sans jetons + durée nulle ».
    const combos = new Map<string, number>();
    for (const une of jeuCouvrable()) {
      const cle = codesPortes(une).join('+') || 'aucune';
      combos.set(cle, (combos.get(cle) ?? 0) + 1);
    }
    expect(Object.fromEntries(combos)).toEqual({
      aucune: 745,
      'sans-agent+sans-jetons': 73,
      'sans-agent+sans-jetons+duree-nulle': 3,
      'duree-aberrante': 23,
      'sans-jetons': 21,
    });
    expect(jeuCouvrable().filter((une) => codesPortes(une).length >= 2).length).toBe(76);
  });

  it('mesure le même 0 % de diffs inconnus que la couverture', () => {
    const sessions = jeuCouvrable();
    // Les deux modules lisent la même règle du `-1` (CONTRATS-REALITE §1) : la
    // ligne `diffs-inconnus` et la part inconnue de la couverture sont un seul
    // et même chiffre, pas deux calculs parallèles.
    expect(qualiteDonnee(sessions).anomalies[4].taux).toEqual(couvertureReelle(sessions).partInconnue);
    // Et ce 0 vient de zéros **mesurés** : aucune session du jeu ne porte -1.
    expect(sessions.filter((une) => une.ajouts === -1).length).toBe(0);
    expect(sessions.filter((une) => une.ajouts === 0).length).toBe(865);
  });
});

describe('qualité de la donnée — les seuils et les cas limites', () => {
  it('borne la durée aberrante à 12 h exclue : 12 h pile ne l’est pas, 12 h + 1 ms l’est', () => {
    expect(DUREE_ABERRANTE_H).toBe(12);
    const douzeHeures = qualiteDonnee([sessionSaine({ dureeMs: 12 * MS_PAR_HEURE })]);
    expect(douzeHeures.anomalies[3].effectif).toBe(0);
    expect(douzeHeures.saines).toBe(1);
    expect(douzeHeures.verdict).toBe('exploitationnable');

    const justeAuDela = qualiteDonnee([sessionSaine({ dureeMs: 12 * MS_PAR_HEURE + 1 })]);
    expect(justeAuDela.anomalies[3].effectif).toBe(1);
    expect(justeAuDela.anomalies[3].taux).toEqual(proportion(1, 1));
    expect(justeAuDela.saines).toBe(0);
    expect(justeAuDela.verdict).toBe('a-manier-avec-prudence');
  });

  it('dit la durée aberrante réelle : 23 sessions, de 13,23 h à 45,99 h', () => {
    const aberrantes = jeuCouvrable()
      .filter((une) => une.dureeMs > 12 * MS_PAR_HEURE)
      .map((une) => une.dureeMs / MS_PAR_HEURE);
    expect(aberrantes.length).toBe(23);
    expect(Math.round(Math.min(...aberrantes) * 100) / 100).toBe(13.23);
    // La plus longue session du jeu : 165 569 949 ms, soit 45,99 h. Une session
    // de quarante-six heures n'est pas une session : c'est une base mal lue.
    expect(Math.max(...jeuCouvrable().map((une) => une.dureeMs))).toBe(165569949);
  });

  it('rend une matière saine à 90 % exploitable, à 80 % prudente, de part et d’autre du seuil', () => {
    const dix = Array.from({ length: 10 }, (_vide, index) => index);
    const neufSaines = qualiteDonnee(dix.map((index) => (
      index === 0 ? sessionSaine({ agent: '' }) : sessionSaine()
    )));
    expect(neufSaines.saines).toBe(9);
    expect(neufSaines.partSaines).toEqual(proportion(9, 10));
    expect(neufSaines.partSaines.rate).toBe(PART_MIN_SAINES);
    expect(neufSaines.verdict).toBe('exploitationnable');

    const huitSaines = qualiteDonnee(dix.map((index) => (
      index < 2 ? sessionSaine({ agent: '' }) : sessionSaine()
    )));
    expect(huitSaines.saines).toBe(8);
    expect(huitSaines.verdict).toBe('a-manier-avec-prudence');
    // Le seuil se lit sur l'estimation ponctuelle : ici la borne haute (94,33 %)
    // dépasse 90 %, et la matière reste prudente. Un verdict tiré de la borne
    // haute aurait inversé la conclusion sur un échantillon de 10.
    expect(huitSaines.partSaines.ciHigh).toBeGreaterThan(PART_MIN_SAINES);
  });

  it('ne confond pas un diff inconnu (-1) et un diff mesuré à zéro', () => {
    const inconnu = qualiteDonnee([sessionSaine({ ajouts: -1, suppressions: -1, fichiersTouches: -1 })]);
    expect(inconnu.anomalies[4].effectif).toBe(1);
    expect(inconnu.saines).toBe(0);

    const mesureZero = qualiteDonnee([sessionSaine({ ajouts: 0, suppressions: 0, fichiersTouches: 0 })]);
    expect(mesureZero.anomalies[4].effectif).toBe(0);
    expect(mesureZero.saines).toBe(1);
    expect(mesureZero.verdict).toBe('exploitationnable');

    // Un seul champ à -1 suffit à déclarer le diff inconnu.
    expect(qualiteDonnee([sessionSaine({ fichiersTouches: -1 })]).anomalies[4].effectif).toBe(1);
    expect(qualiteDonnee([sessionSaine({ suppressions: -1 })]).anomalies[4].effectif).toBe(1);
  });

  it('compte « sans agent » sur un agent vide, pas sur un nom', () => {
    const sessions = jeuCouvrable();
    expect(sessions.filter((une) => une.agent.trim() === '').length).toBe(76);
    // Un agent nommé n'est pas une lacune, même un agent d'espaces le devient.
    expect(qualiteDonnee([sessionSaine({ agent: '   ' })]).anomalies[0].effectif).toBe(1);
    expect(qualiteDonnee([sessionSaine({ agent: 'build' })]).anomalies[0].effectif).toBe(0);
    // « sans jetons » : la somme des deux volumes, mesurée à zéro.
    expect(qualiteDonnee([sessionSaine({ jetonsEntree: 0, jetonsSortie: 0 })]).anomalies[1].effectif).toBe(1);
    expect(qualiteDonnee([sessionSaine({ jetonsEntree: 0, jetonsSortie: 1 })]).anomalies[1].effectif).toBe(0);
  });

  it('sur une liste vide, rend un verdict prudent : rien n’est mesuré, donc rien n’est exploitable', () => {
    const vide = qualiteDonnee([]);
    expect(vide.sessions).toBe(0);
    expect(vide.saines).toBe(0);
    expect(vide.partSaines).toEqual({ n: 0, rate: 0, ciLow: 0, ciHigh: 1 });
    expect(vide.verdict).toBe('a-manier-avec-prudence');
    // Les cinq lignes restent, chacune à effectif nul et `n = 0`.
    expect(vide.anomalies.map((anomalie) => anomalie.code)).toEqual(ANOMALIES);
    for (const anomalie of vide.anomalies) {
      expect(anomalie.effectif).toBe(0);
      expect(anomalie.taux).toEqual({ n: 0, rate: 0, ciLow: 0, ciHigh: 1 });
    }
  });

  it('ne rend aucune sortie par personne (DP-17)', () => {
    const qualite = qualiteDonnee(jeuCouvrable());
    expect(Object.keys(qualite).sort()).toEqual([
      'anomalies', 'partSaines', 'saines', 'sessions', 'verdict',
    ]);
    for (const champ of Object.keys(qualite)) {
      expect(champ).not.toMatch(/personne|utilisateur|auteur|owner|email|login/i);
    }
    // Les seules clés du verdict sont les cinq codes figés : rien ne peut y
    // passer une identité.
    const codes = qualite.anomalies.map((anomalie) => anomalie.code);
    expect(codes.sort()).toEqual([...ANOMALIES].sort());
    expect(qualite.verdict).toMatch(/^(exploitationnable|a-manier-avec-prudence)$/);
  });
});
