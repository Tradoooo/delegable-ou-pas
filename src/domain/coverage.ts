/**
 * La couverture **réelle** : ce que la donnée réelle du poste couvre, et ce
 * qu'elle ne couvre pas.
 *
 * Pourquoi ce module existe : le produit ne décide qu'à partir de faits
 * mesurés, et la télémétrie du poste est la seule chose qu'il ait sous la
 * main en dehors de la démonstration. La question utile n'y est donc pas
 * « combien de tickets », mais « quelle part de la matière est rattachée à un
 * ticket, et quelle part est mesurable ». Un agent qui travaille sans ticket
 * ne produit aucune preuve que l'app peut utiliser ; une session sans diff
 * mesuré ne dit rien du code produit.
 *
 * Trois règles structurent le module :
 *
 *  1. **Aucun chiffre sans son effectif ni sa fourchette.** Les parts
 *     viennent de `proportion()` (`src/domain/stats.ts`) : la formule de
 *     Wilson n'est pas réécrite ici (CONTRATS-REALITE §4.3).
 *  2. **L'inconnu n'est pas un zéro.** Une session dont le diff est inconnu
 *     (`-1`) est comptée à part, jamais comme une session « à zéro diff »
 *     mesurée : c'est la règle « on ne sait pas est une conclusion » appliquée
 *     à la donnée (CONTRATS-REALITE §1).
 *  3. **Jamais par personne.** Le module ne connaît ni nom ni classement
 *     individuel : il ne compte que des projets, des modèles et des tickets.
 *
 * Module PUR : aucune horloge, aucun disque, aucun réseau. Les entrées
 * arrivent en paramètres, la sortie est une valeur.
 *
 * Règle : fichiers < 500 lignes, fonctions < 50 lignes.
 */
import { proportion } from './stats.js';
import { etiquetteModele, INCONNU } from './machine-cost.js';
import type { ProportionStat } from '../types.js';

/**
 * Une session réelle, vue par les seuls champs que ce lot mesure.
 *
 * C'est un **sous-ensemble structurel** de la `SessionReelle` du contrat gelé
 * (CONTRATS-REALITE §1) : les champs portent exactement les mêmes noms et les
 * mêmes types, donc une session du contrat s'y branche sans adaptation — la
 * même démarche que `SessionCoutable` dans `src/domain/machine-cost.ts`.
 */
export interface SessionCouvrable {
  /** Projet relatif, jamais un chemin absolu. */
  readonly projet: string;
  /** Agent qui a fait le travail : `build`, `general`, `explore`… ou `''`. */
  readonly agent: string;
  /** Modèle réellement utilisé, avec son fournisseur. */
  readonly modele: { readonly provider: string; readonly id: string };
  /** Jetons d'entrée mesurés. */
  readonly jetonsEntree: number;
  /** Jetons de sortie mesurés. */
  readonly jetonsSortie: number;
  /** Lignes ajoutées : `-1` quand la donnée n'est pas connue. */
  readonly ajouts: number;
  /** Lignes supprimées : `-1` quand la donnée n'est pas connue. */
  readonly suppressions: number;
  /** Fichiers touchés : `-1` quand la donnée n'est pas connue. */
  readonly fichiersTouches: number;
  /** Durée réelle d'exécution, en millisecondes. */
  readonly dureeMs: number;
  /** Clé de ticket rattachée (`PROJ-101`), `null` quand elle est inconnue. */
  readonly cleTicket: string | null;
}

/** Une part de la matière : son effectif, et sa part avec son intervalle. */
export interface Repartition {
  /** La clé : le projet, ou l'étiquette du modèle. */
  readonly cle: string;
  /** L'effectif de la part : combien de sessions. */
  readonly sessions: number;
  /** La part du corpus, avec son effectif et son intervalle de Wilson. */
  readonly part: ProportionStat;
}

/** Ce que la donnée réelle couvre, et ce qu'elle ne couvre pas. */
export interface CouvertureReelle {
  /** Nombre de sessions connues. */
  readonly sessions: number;
  /** Sessions rattachées à un ticket. */
  readonly avecTicket: number;
  /** Sessions dont le ticket est inconnu. */
  readonly sansTicket: number;
  /** Part des sessions rattachées à un ticket, avec son intervalle. */
  readonly tauxTicket: ProportionStat;
  /** Part « inconnue » : sessions dont le code produit n'est pas mesuré. */
  readonly partInconnue: ProportionStat;
  /** Répartition par projet, la plus grosse part d'abord. */
  readonly parProjet: readonly Repartition[];
  /** Répartition par modèle, la plus grosse part d.first. */
  readonly parModele: readonly Repartition[];
}

/** La clé d'une session dans une répartition. */
type Cle = (session: SessionCouvrable) => string;

/** Vrai quand la session ne dit rien du code qu'elle a produit. */
function diffsInconnus(session: SessionCouvrable): boolean {
  return (
    session.ajouts === INCONNU ||
    session.suppressions === INCONNU ||
    session.fichiersTouches === INCONNU
  );
}

/**
 * Répartit les sessions par clé, chaque part portant son effectif et sa part
 * avec son intervalle. Les parts sont triées par effectif décroissant, puis
 * par clé : l'ordre ne dépend donc pas de l'ordre d'arrivée.
 */
function repartit(sessions: readonly SessionCouvrable[], cle: Cle): Repartition[] {
  const compte = new Map<string, number>();
  for (const session of sessions) {
    const nom = cle(session);
    compte.set(nom, (compte.get(nom) ?? 0) + 1);
  }
  return [...compte.entries()]
    .map(([nom, effectif]) => ({
      cle: nom,
      sessions: effectif,
      part: proportion(effectif, sessions.length),
    }))
    .sort((a, b) => b.sessions - a.sessions || (a.cle < b.cle ? -1 : 1));
}

/**
 * La couverture d'une liste de sessions réelles.
 *
 * Une liste vide ne rend pas un taux de zéro : `proportion()` rend alors
 * `{ n: 0, rate: 0, ciLow: 0, ciHigh: 1 }`, c'est-à-dire « rien n'est
 * mesuré » (SPEC §20, recette 10).
 */
export function couvertureReelle(sessions: readonly SessionCouvrable[]): CouvertureReelle {
  const avecTicket = sessions.filter((session) => session.cleTicket !== null).length;
  const inconnues = sessions.filter(diffsInconnus).length;
  return {
    sessions: sessions.length,
    avecTicket,
    sansTicket: sessions.length - avecTicket,
    tauxTicket: proportion(avecTicket, sessions.length),
    partInconnue: proportion(inconnues, sessions.length),
    parProjet: repartit(sessions, (session) => session.projet),
    parModele: repartit(sessions, (session) => etiquetteModele(session.modele)),
  };
}
