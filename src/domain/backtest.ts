/**
 * Rejeu honnête du graphe versionné : constats observés, pas performance causale.
 * Les PR donnent la durée d'ouverture→merge et le diff les changements git ;
 * aucune session, cohorte ticket ni recommandation individuelle n'est inventée.
 */
import type { JeuGraphe, CommitGraphe, PullRequestGraphe } from '../collect/git-history.js';
import { diffsCommit, rattachementTickets } from '../collect/git-history.js';
import { INCONNU } from '../collect/session-reelle.js';
import { medianInterval, proportion } from './stats.js';
import type { ProportionStat } from '../types.js';

export type BlocageBacktest = 'aucune-liaison-ticket' | 'bras-comparateur-absent' | 'aucune-observation';
export interface PeriodeBacktest {
  readonly periode: string;
  readonly recommandation: 'deleguer' | 'ne-pas-deleguer' | 'indeterminee';
  readonly prsFusionnees: number;
  readonly dureeMergeH: { readonly n: number; readonly medianeH: number; readonly ciLowH: number; readonly ciHighH: number; readonly minH: number; readonly maxH: number };
  readonly commits: number;
  readonly diffsMesures: number;
  readonly mentionsAgent: ProportionStat;
}
export interface BilanBacktest {
  readonly periodes: readonly PeriodeBacktest[];
  readonly commits: number;
  readonly prs: number;
  readonly prsFusionnees: number;
  readonly liaisonsTicket: ProportionStat;
  readonly blocages: readonly BlocageBacktest[];
}

/** Construit un résumé observable pour la période fournie (sans horloge). */
function bilanPeriode(label: string, commits: readonly CommitGraphe[], prs: readonly PullRequestGraphe[]): PeriodeBacktest {
  const durees = prs.filter((pr) => pr.fusionnee !== null && pr.dureeMs >= 0).map((pr) => pr.dureeMs / 3_600_000);
  const intervalle = medianInterval(durees);
  const triees = [...durees].sort((a, b) => a - b);
  const mesurables = commits.filter((commit) => diffsCommit(commit).ajouts !== INCONNU).length;
  const mentions = commits.filter((commit) => commit.mentionAgent.length > 0).length;
  return {
    periode: label,
    recommandation: 'indeterminee',
    prsFusionnees: durees.length,
    dureeMergeH: { n: intervalle.n, medianeH: durees.length ? intervalle.medianH : INCONNU,
      ciLowH: durees.length ? intervalle.ciLow : INCONNU, ciHighH: durees.length ? intervalle.ciHigh : INCONNU,
      minH: triees[0] ?? INCONNU, maxH: triees[triees.length - 1] ?? INCONNU },
    commits: commits.length, diffsMesures: mesurables, mentionsAgent: proportion(mentions, commits.length),
  };
}

/** Rejoue le jeu réel en périodes explicites ; sans deux bras n'émet aucun score. */
export function backtester(jeu: JeuGraphe, periodes: readonly { readonly label: string; readonly depuis: string; readonly jusqua: string }[]): BilanBacktest {
  const ordonnees = [...periodes].sort((a, b) => a.label.localeCompare(b.label));
  const sorties = ordonnees.map((periode) => {
    const commits = jeu.commits.filter((c) => c.dateAuteur >= periode.depuis && c.dateAuteur < periode.jusqua);
    const prs = (jeu.pullRequests ?? []).filter((pr) => pr.ouverte >= periode.depuis && pr.ouverte < periode.jusqua);
    return bilanPeriode(periode.label, commits, prs);
  });
  const ticket = rattachementTickets(jeu.commits).liaisons;
  const blocages: BlocageBacktest[] = [];
  if (jeu.commits.length === 0 && (jeu.pullRequests?.length ?? 0) === 0) blocages.push('aucune-observation');
  if (jeu.commits.length > 0 && ticket.rate === 0) blocages.push('aucune-liaison-ticket');
  blocages.push('bras-comparateur-absent');
  return { periodes: sorties, commits: jeu.commits.length, prs: jeu.pullRequests?.length ?? INCONNU,
    prsFusionnees: jeu.pullRequests?.filter((pr) => pr.fusionnee !== null && pr.dureeMs >= 0).length ?? INCONNU,
    liaisonsTicket: ticket, blocages };
}
