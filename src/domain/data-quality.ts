/**
 * La qualité de la donnée : ce que la matière réelle porte et ce qu'elle ne
 * porte pas.
 *
 * Pourquoi ce module existe : le produit ne ment pas sur ses données, donc il
 * doit savoir *quand* ses données sont lacunaires. Une session sans agent ne
 * dit pas qui a travaillé ; une session sans jetons ne dit rien du volume ;
 * une session de zéro durée n'a rien duré ; une session de quarante-six heures
 * n'est pas une session ; et une session sans diff ne dit rien du code
 * produit. Chacune de ces lacunes est une **anomalie** : elle se compte, elle
 * a un effectif et une part avec son intervalle.
 *
 * Deux règles structurent le module :
 *
 *  1. **Absent = `-1`, jamais `0`** (CONTRATS-REALITE §1). Un diff inconnu
 *     est compté comme *inconnu* ; un diff mesuré à zéro reste un zéro. Le
 *     module ne confond jamais les deux, et ne les additionne pas non plus.
 *  2. **Aucun chiffre sans son effectif ni sa fourchette.** Les parts viennent
 *     de `proportion()` (`src/domain/stats.ts`) : la formule de Wilson n'est
 *     pas réécrite ici.
 *
 * Le verdict global est une **conclusion**, pas une impression : il se déduit
 * de la part de sessions saines (celles qui ne portent aucune anomalie), et
 * du seuil documenté `PART_MIN_SAINES`. Une matière dont neuf sessions sur
 * dix sont intactes reste exploitable ; en dessous, elle ne l'est pas.
 *
 * Module PUR : aucune horloge, aucun disque, aucun réseau.
 *
 * Règle : fichiers < 500 lignes, fonctions < 50 lignes.
 */
import { proportion } from './stats.js';
import { INCONNU } from './machine-cost.js';
import type { ProportionStat } from '../types.js';
import type { SessionCouvrable } from './coverage.js';

/** La durée au-delà de laquelle une session n'est plus une session (heures). */
export const DUREE_ABERRANTE_H = 12;

const MS_PAR_HEURE = 3_600_000;

/** La part minimale de sessions saines pour que la matière reste exploitable. */
export const PART_MIN_SAINES = 0.9;

/** Le code d'une anomalie de la donnée. */
export type CodeAnomalie =
  | 'sans-agent'
  | 'sans-jetons'
  | 'duree-nulle'
  | 'duree-aberrante'
  | 'diffs-inconnus';

/** Les anomalies que la donnée réelle peut porter, dans l'ordre du contrat. */
export const ANOMALIES: readonly CodeAnomalie[] = [
  'sans-agent',
  'sans-jetons',
  'duree-nulle',
  'duree-aberrante',
  'diffs-inconnus',
];

/** Une anomalie : ce qu'elle touche, et combien de fois. */
export interface Anomalie {
  /** Le code de l'anomalie. */
  readonly code: CodeAnomalie;
  /** L'effectif : combien de sessions portent l'anomalie. */
  readonly effectif: number;
  /** La part du corpus, avec son effectif et son intervalle de Wilson. */
  readonly taux: ProportionStat;
}

/** Le verdict global sur la matière : exploitable, ou à manier avec prudence. */
export type VerdictDonnee = 'exploitationnable' | 'a-manier-avec-prudence';

/** La qualité d'une liste de sessions réelles. */
export interface QualiteDonnee {
  /** Nombre de sessions connues. */
  readonly sessions: number;
  /** Une ligne par anomalie, toujours dans l'ordre de `ANOMALIES`. */
  readonly anomalies: readonly Anomalie[];
  /** Sessions ne portant aucune anomalie. */
  readonly saines: number;
  /** Part des sessions saines, avec son effectif et son intervalle. */
  readonly partSaines: ProportionStat;
  /** Le verdict global, déduit de `partSaines`. */
  readonly verdict: VerdictDonnee;
}

/** Les anomalies qu'une session porte : une session peut en porter plusieurs. */
function anomaliesDe(session: SessionCouvrable): readonly CodeAnomalie[] {
  const codes: CodeAnomalie[] = [];
  if (session.agent.trim() === '') codes.push('sans-agent');
  if (session.jetonsEntree + session.jetonsSortie === 0) codes.push('sans-jetons');
  if (session.dureeMs === 0) codes.push('duree-nulle');
  if (session.dureeMs > DUREE_ABERRANTE_H * MS_PAR_HEURE) codes.push('duree-aberrante');
  if (session.ajouts === INCONNU || session.suppressions === INCONNU || session.fichiersTouches === INCONNU) {
    codes.push('diffs-inconnus');
  }
  return codes;
}

/** La part des sessions saines, avec son intervalle, et le verdict qui en découle. */
function verdictDe(saines: number, total: number): { partSaines: ProportionStat; verdict: VerdictDonnee } {
  const partSaines = proportion(saines, total);
  return {
    partSaines,
    verdict: partSaines.rate >= PART_MIN_SAINES ? 'exploitationnable' : 'a-manier-avec-prudence',
  };
}

/**
 * La qualité d'une liste de sessions réelles.
 *
 * Une liste vide ne rend pas une matière « exploitable » par défaut : sans
 * session, rien n'est mesuré, donc rien n'est exploitable — le verdict est
 * prudent et les parts portent `n = 0` (SPEC §20).
 */
export function qualiteDonnee(sessions: readonly SessionCouvrable[]): QualiteDonnee {
  const effectifs = new Map<CodeAnomalie, number>();
  let saines = 0;
  for (const session of sessions) {
    const codes = anomaliesDe(session);
    if (codes.length === 0) saines += 1;
    for (const code of codes) effectifs.set(code, (effectifs.get(code) ?? 0) + 1);
  }
  const anomalies = ANOMALIES.map((code) => {
    const effectif = effectifs.get(code) ?? 0;
    return { code, effectif, taux: proportion(effectif, sessions.length) };
  });
  return {
    sessions: sessions.length,
    anomalies,
    saines,
    ...verdictDe(saines, sessions.length),
  };
}
