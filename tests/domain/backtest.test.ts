/**
 * Backtest du graphe réel versionné : le bilan ne transforme pas l'historique
 * en preuve causale. Durées de PR, diffs, mentions et zéro liaison ticket.
 * Aucune session n'est attribuée à un commit, et aucune sortie nominative.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { backtester } from '../../src/domain/backtest.js';
import { lireJeu } from '../../src/collect/git-history.js';
import type { JeuGraphe } from '../../src/collect/git-history.js';
import { INCONNU } from '../../src/collect/session-reelle.js';

const JEU = fileURLToPath(new URL('../../src/sample/git-history-real.json', import.meta.url));
/** Charge la source versionnée sans fabriquer de jeu de test. */
function jeuReel(): JeuGraphe { return lireJeu(JSON.parse(readFileSync(JEU, 'utf8'))); }
const TOUS = [{ label: 'historique', depuis: '0000', jusqua: '9999' }];

describe('rejeu réel — matière et limites', () => {
  it('compte les commits, PR fusionnées, durées réelles et mentions du jeu', () => {
    const bilan = backtester(jeuReel(), TOUS);
    expect(bilan.commits).toBe(92);
    expect(bilan.prs).toBe(111);
    expect(bilan.prsFusionnees).toBe(68);
    expect(bilan.liaisonsTicket.n).toBe(92);
    expect(bilan.liaisonsTicket.rate).toBe(0);
    const periode = bilan.periodes[0];
    expect(periode.dureeMergeH.n).toBe(68);
    expect(Math.round(periode.dureeMergeH.medianeH * 1e6) / 1e6).toBe(0.196389);
    expect(Math.round(periode.dureeMergeH.minH * 1e6) / 1e6).toBe(0.015556);
    expect(Math.round(periode.dureeMergeH.maxH * 1e6) / 1e6).toBe(21.190833);
    expect(periode.mentionsAgent.n).toBe(92);
    expect(periode.mentionsAgent.rate * 92).toBe(6);
    expect(periode.diffsMesures).toBe(92);
    expect(bilan.blocages).toContain('aucune-liaison-ticket');
    expect(periode.recommandation).toBe('indeterminee');
  });

  it('liste vide : rien mesuré, blocage explicite, aucune recommandation flatteuse', () => {
    const jeu = jeuReel();
    const vide = { ...jeu, commits: [], pullRequests: [] };
    const bilan = backtester(vide, TOUS);
    expect(bilan.commits).toBe(0);
    expect(bilan.prsFusionnees).toBe(0);
    expect(bilan.periodes[0].dureeMergeH.medianeH).toBe(INCONNU);
    expect(bilan.periodes[0].mentionsAgent.n).toBe(0);
    expect(bilan.blocages).toContain('aucune-observation');
    expect(bilan.periodes[0].recommandation).toBe('indeterminee');
  });

  it('un seul bras observé est un blocage nommé, jamais un score', () => {
    const bilan = backtester(jeuReel(), TOUS);
    expect(bilan.blocages).toContain('bras-comparateur-absent');
  });

  it('ne compte pas un diff absent comme zéro mesuré', () => {
    const jeu = jeuReel();
    const commit = jeu.commits[0];
    const sansLignes = { ...commit, lignesInconnues: true };
    const bilan = backtester({ ...jeu, commits: [sansLignes], pullRequests: [] }, TOUS);
    expect(bilan.periodes[0].commits).toBe(1);
    expect(bilan.periodes[0].diffsMesures).toBe(0);
  });

  it('est indépendant de l’ordre des périodes et ne produit aucune sortie par personne', () => {
    const jeu = jeuReel();
    const periodes = [
      { label: 'B', depuis: '2026-11-12', jusqua: '2027-01-01' },
      { label: 'A', depuis: '2026-11-11', jusqua: '2026-11-12' },
    ];
    const a = backtester(jeu, periodes);
    const b = backtester(jeu, [...periodes].reverse());
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toMatch(/email|login|auteur|utilisateur/i);
    expect(Object.keys(a)).not.toContain('personnes');
  });
});
