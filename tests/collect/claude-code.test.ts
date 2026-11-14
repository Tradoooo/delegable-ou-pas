/**
 * Tests du deuxième client agent : le jeu de données RÉEL Claude Code
 * (`src/sample/claude-code-real.json`, 388 sessions récoltées sur cette machine
 * par `tools/claude-code/harvest.mjs`) et les cas limites du contrat.
 *
 * Deux volets assumés (contrat §4.5) : les chiffres portés par la suite sont
 * ceux du fichier versionné — un test qui construit sa propre fixture ne prouve
 * rien sur le réel — et les cas limites (liste vide, valeur absente, modèle
 * fabriqué, JSON illisible) ont besoin de fixtures, parce que le réel ne les
 * contient pas.
 *
 * Aucun réseau, aucune base vivante ici : la source `~/.claude/projects` n'est
 * lue que par la récolte, jamais par un test (contrat §4.6).
 *
 * Chaque taux est rendu avec son effectif et sa fourchette (`proportion()` de
 * `src/domain/stats.ts`, jamais de Wilson réimplémenté — contrat §4.3).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  depuisClaudeCode,
  entreeConsommee,
  etiquetteModele,
  normaliserModele,
  parseDatasetClaudeCode,
  summariseClaudeCode,
} from '../../src/collect/claude-code.js';
import type { ClaudeCodeSession } from '../../src/collect/claude-code.js';
import { INCONNU, jetons, ticketsDistincts } from '../../src/collect/session-reelle.js';
import { proportion } from '../../src/domain/stats.js';

const CHEMIN_JEU = fileURLToPath(new URL('../../src/sample/claude-code-real.json', import.meta.url));
const MOTIF_ID_PUBLIC = /^cc_[0-9a-f]{16}$/;
const MOTIF_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const MOTIF_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const MOTIF_CHEMIN_ABSOLU = /\/(?:home|Users|root|private|var)\//;
/** Le login de la machine : jamais le leur en CI, jamais dans le jeu non plus. */
const LOGIN = basename(homedir());

/** Le texte brut du jeu versionné : c'est lui qui se contrôle, pas une copie. */
function jeuBrut(): string {
  return readFileSync(CHEMIN_JEU, 'utf8');
}

/** Le jeu réel, passé par le parseur du contrat. */
function jeuReel(): readonly ClaudeCodeSession[] {
  return parseDatasetClaudeCode(JSON.parse(jeuBrut())).sessions;
}

/** Une session de fixture : les cas limites que le réel ne porte pas. */
function fixture(part: Partial<ClaudeCodeSession>): ClaudeCodeSession {
  return {
    id: 'cc_fixture00000001',
    project: 'Bureau/projet-x',
    branch: 'main',
    model: { provider: 'anthropic', id: 'claude-opus-5-5' },
    costEuros: INCONNU,
    tokensIn: 100,
    tokensOut: 50,
    cacheCreation: 10,
    cacheRead: 20,
    durationMs: 3_600_000,
    startedAt: '2026-11-01T10:00:00.000Z',
    endedAt: '2026-11-01T11:00:00.000Z',
    issueKey: null,
    ...part,
  };
}

const SOMME = (sessions: readonly ClaudeCodeSession[], prendre: (s: ClaudeCodeSession) => number): number =>
  sessions.reduce((total, session) => total + prendre(session), 0);

describe('jeu réel Claude Code — volume et identité', () => {
  it('porte les 388 sessions réellement vécues sur ce poste', () => {
    const sessions = jeuReel();
    expect(sessions.length).toBe(388);
    expect(new Set(sessions.map((session) => session.id)).size).toBe(388);
  });

  it('ne publie que des clés publiques hachées, au format du contrat', () => {
    for (const session of jeuReel()) {
      expect(session.id).toMatch(MOTIF_ID_PUBLIC);
      expect(session.project.startsWith('/')).toBe(false);
    }
  });

  it('est trié par clé publique : deux récoltes donnent les mêmes octets', () => {
    const ids = jeuReel().map((session) => session.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('couvre plus de vingt jours : la récolte n’est pas un jour isolé', () => {
    const dates = jeuReel().map((session) => Date.parse(session.startedAt)).sort((a, b) => a - b);
    expect(dates[0]).toBeGreaterThan(0);
    expect((dates[dates.length - 1] - dates[0]) / 86_400_000).toBeGreaterThan(20);
  });
});

describe('jeu réel Claude Code — les jetons réellement mesurés', () => {
  it('cumule 29 022 jetons d’entrée fraîche et 40 378 343 de sortie', () => {
    const sessions = jeuReel();
    expect(SOMME(sessions, (session) => session.tokensIn)).toBe(29_022);
    expect(SOMME(sessions, (session) => session.tokensOut)).toBe(40_378_343);
  });

  it('porte un cache de 3 400 015 548 jetons relus et 90 925 821 créés', () => {
    const sessions = jeuReel();
    expect(SOMME(sessions, (session) => session.cacheRead)).toBe(3_400_015_548);
    expect(SOMME(sessions, (session) => session.cacheCreation)).toBe(90_925_821);
  });

  it('met le cache dans l’entrée du contrat : 3 490 970 391 jetons d’entrée', () => {
    const sessions = jeuReel();
    expect(SOMME(sessions, entreeConsommee)).toBe(3_490_970_391);
  });

  it('pèse 3 531 348 734 jetons une fois passé dans la session unifiée', () => {
    const unifiees = jeuReel().map(depuisClaudeCode);
    expect(unifiees.length).toBe(388);
    expect(unifiees.reduce((total, session) => total + jetons(session), 0)).toBe(3_531_348_734);
  });

  it('cumule 713 361 424 millisecondes de travail, soit 198,16 heures', () => {
    const resume = summariseClaudeCode(jeuReel());
    expect(resume.dureeMs).toBe(713_361_424);
    expect(Math.round((resume.dureeMs / 3_600_000) * 100) / 100).toBe(198.16);
  });
});

describe('jeu réel Claude Code — diversité réelle', () => {
  it('compte cinq modèles distincts, dont le modèle inconnu', () => {
    const resume = summariseClaudeCode(jeuReel());
    expect(resume.modeles.length).toBe(5);
    expect(resume.modeles).toContain('anthropic/claude-opus-5-5');
    expect(resume.modeles).toContain('anthropic/claude-fable-5-2');
    expect(resume.modeles).toContain('anthropic/claude-sonnet-5-5');
    expect(resume.modeles).toContain('anthropic/claude-haiku-5-5');
    expect(resume.modeles).toContain('inconnu/inconnu');
  });

  it('compte dix-neuf branches et trente-et-un projets relatifs', () => {
    const resume = summariseClaudeCode(jeuReel());
    expect(resume.branches.length).toBe(19);
    expect(resume.branches).toContain('HEAD');
    expect(resume.projets.length).toBe(31);
  });

  it('répartit les sessions : 259 sans modèle connu sur 388, six sessions sur dix', () => {
    const resume = summariseClaudeCode(jeuReel());
    expect(resume.sansModeleConnu).toBe(259);
    const part = proportion(resume.sansModeleConnu, resume.sessions);
    expect(part.n).toBe(388);
    expect(part.rate).toBeCloseTo(259 / 388, 10);
    expect(part.ciLow).toBeGreaterThan(0.6);
    expect(part.ciHigh).toBeLessThan(0.75);
    expect(part.ciLow).toBeLessThanOrEqual(part.rate);
    expect(part.rate).toBeLessThanOrEqual(part.ciHigh);
  });

  it('laisse 129 sessions sur 388 avec un jeton mesuré non nul', () => {
    const sessions = jeuReel();
    const vivantes = sessions.filter((session) => session.tokensIn + session.tokensOut > 0).length;
    expect(vivantes).toBe(129);
    const part = proportion(vivantes, sessions.length);
    expect(part.n).toBe(388);
    expect(part.rate).toBeCloseTo(129 / 388, 10);
    expect(part.ciLow).toBeGreaterThan(0.25);
    expect(part.ciHigh).toBeLessThan(0.45);
  });
});

describe('jeu réel Claude Code — ce qui n’est pas mesuré reste inconnu', () => {
  it('ne connaît le coût d’aucune session : le flux ne porte aucun prix', () => {
    for (const session of jeuReel().map(depuisClaudeCode)) {
      expect(session.coutEuros).toBe(INCONNU);
      expect(session.coutEuros).not.toBe(0);
    }
  });

  it('ne connaît aucun diff : ni ligne ajoutée, ni ligne supprimée, ni fichier', () => {
    for (const session of jeuReel().map(depuisClaudeCode)) {
      expect(session.ajouts).toBe(INCONNU);
      expect(session.suppressions).toBe(INCONNU);
      expect(session.fichiersTouches).toBe(INCONNU);
    }
  });

  it('ne rattache aucune session à un ticket : zéro sur 388, sans fenêtre temporelle', () => {
    const unifiees = jeuReel().map(depuisClaudeCode);
    expect(summariseClaudeCode(jeuReel()).avecTicket).toBe(0);
    expect(ticketsDistincts(unifiees)).toEqual([]);
    const part = proportion(0, unifiees.length);
    expect(part.n).toBe(388);
    expect(part.rate).toBe(0);
    expect(part.ciHigh).toBeGreaterThan(0);
  });

  it('n’a aucune session sans horodatage : zéro sur 388, et la fourchette le dit', () => {
    const resume = summariseClaudeCode(jeuReel());
    expect(resume.sansTimestamp).toBe(0);
    const part = proportion(resume.sansTimestamp, resume.sessions);
    expect(part.n).toBe(388);
    expect(part.rate).toBe(0);
    expect(part.ciHigh).toBeLessThan(0.02);
  });

  it('garde le zéro mesuré pour ce qui vaut zéro : une session de durée nulle', () => {
    const sessions = jeuReel();
    expect(sessions.filter((session) => session.durationMs === 0).length).toBe(1);
    expect(sessions.filter((session) => session.durationMs === INCONNU).length).toBe(0);
  });
});

describe('session unifiée — depuisClaudeCode applique le contrat', () => {
  it('déclare le client claude-code et l’attribution aucune', () => {
    const session = depuisClaudeCode(fixture({}));
    expect(session.client).toBe('claude-code');
    expect(session.attribution).toBe('aucune');
    expect(session.cleTicket).toBeNull();
  });

  it('ne publie ni titre ni agent : ce flux est du texte libre de conversation', () => {
    for (const session of jeuReel().map(depuisClaudeCode)) {
      expect(session.titre).toBe('');
      expect(session.agent).toBe('');
    }
  });

  it('met l’entrée fraîche, le cache créé et le cache relu dans jetonsEntree', () => {
    const session = depuisClaudeCode(fixture({}));
    expect(session.jetonsEntree).toBe(100 + 10 + 20);
    expect(session.jetonsSortie).toBe(50);
  });

  it('rend une durée inconnue en -1, jamais en 0', () => {
    const session = depuisClaudeCode(fixture({ durationMs: INCONNU, startedAt: '', endedAt: '' }));
    expect(session.dureeMs).toBe(INCONNU);
    expect(session.dureeMs).not.toBe(0);
  });

  it('laisse un zéro mesuré valoir zéro : la session ratée n’a consommé aucun jeton', () => {
    const session = depuisClaudeCode(fixture({ tokensIn: 0, tokensOut: 0, cacheCreation: 0, cacheRead: 0 }));
    expect(session.jetonsEntree).toBe(0);
    expect(session.jetonsSortie).toBe(0);
  });

  it("n'invente aucun champ personnel : la forme est celle du contrat", () => {
    const cles = Object.keys(depuisClaudeCode(fixture({}))).sort();
    expect(cles).toEqual([
      'agent', 'ajouts', 'attribution', 'cleTicket', 'client', 'coutEuros', 'debut',
      'dureeMs', 'fichiersTouches', 'fin', 'id', 'jetonsEntree', 'jetonsSortie',
      'modele', 'projet', 'suppressions', 'titre',
    ]);
  });
});

describe('cas limites — ce que le réel ne contient pas', () => {
  it('une liste vide ne mesure rien, sans erreur', () => {
    const vide = parseDatasetClaudeCode({ generatedAt: '2026-11-01T00:00:00.000Z', source: 'claude-code', sessions: [] });
    expect(vide.sessions).toEqual([]);
    const resume = summariseClaudeCode(vide.sessions);
    expect(resume.sessions).toBe(0);
    expect(resume.dureeMs).toBe(0);
    expect(resume.modeles).toEqual([]);
    const part = proportion(0, 0);
    expect(part).toEqual({ n: 0, rate: 0, ciLow: 0, ciHigh: 1 });
  });

  it('un champ absent vaut -1, jamais 0', () => {
    const [seule] = parseDatasetClaudeCode({ sessions: [{ id: 'cc_absent00000001' }] }).sessions;
    expect(seule.costEuros).toBe(INCONNU);
    expect(seule.tokensIn).toBe(INCONNU);
    expect(seule.durationMs).toBe(INCONNU);
    expect(entreeConsommee(seule)).toBe(INCONNU);
    expect(depuisClaudeCode(seule).jetonsEntree).toBe(INCONNU);
  });

  it('`<synthetic>` n’est pas un modèle : ça devient un modèle inconnu', () => {
    expect(normaliserModele({ provider: 'anthropic', id: '<synthetic>' })).toEqual({ provider: 'inconnu', id: 'inconnu' });
    expect(normaliserModele({ provider: '', id: '' })).toEqual({ provider: 'inconnu', id: 'inconnu' });
    expect(normaliserModele({ provider: '', id: 'claude-opus-5-5' })).toEqual({ provider: 'anthropic', id: 'claude-opus-5-5' });
    expect(etiquetteModele({ provider: 'anthropic', id: '<synthetic>' })).toBe('inconnu/inconnu');
  });

  it('un cache partiellement inconnu ne s’additionne pas : l’entrée reste inconnue', () => {
    expect(entreeConsommee(fixture({ cacheRead: INCONNU }))).toBe(INCONNU);
  });

  it('refuse un JSON illisible plutôt que d’en amputer le réel', () => {
    expect(() => parseDatasetClaudeCode(null)).toThrow(/illisible/);
    expect(() => parseDatasetClaudeCode('claude-code')).toThrow(/illisible/);
    expect(() => parseDatasetClaudeCode({ sessions: {} })).toThrow(/`sessions` doit être une liste/);
    expect(() => parseDatasetClaudeCode({ sessions: [{ project: 'Bureau/x' }] })).toThrow(/sans identifiant/);
  });

  it('force `issueKey` à null : le flux ne prouve aucun ticket', () => {
    const lue = parseDatasetClaudeCode({ sessions: [{ id: 'cc_ticket00000001', issueKey: 'PROJ-9' }] }).sessions[0];
    expect(lue.issueKey).toBeNull();
    expect(depuisClaudeCode(lue).cleTicket).toBeNull();
  });
});

describe('anonymat — le dépôt public ne porte aucune donnée personnelle', () => {
  it('ne contient aucun email, aucun chemin absolu, aucun UUID brut', () => {
    const texte = jeuBrut();
    expect(MOTIF_EMAIL.test(texte)).toBe(false);
    expect(MOTIF_CHEMIN_ABSOLU.test(texte)).toBe(false);
    expect(MOTIF_UUID.test(texte)).toBe(false);
    expect(texte.toLowerCase()).not.toContain(LOGIN.toLowerCase());
  });

  it('n’a aucune clé de texte libre : ni prompt, ni contenu, ni titre', () => {
    const premier = JSON.parse(jeuBrut()).sessions[0] as Record<string, unknown>;
    expect(Object.keys(premier).sort()).toEqual([
      'branch', 'cacheCreation', 'cacheRead', 'costEuros', 'durationMs', 'endedAt',
      'id', 'issueKey', 'model', 'project', 'startedAt', 'tokensIn', 'tokensOut',
    ]);
    for (const cle of Object.keys(premier)) {
      expect(['text', 'content', 'prompt', 'title', 'message', 'cwd', 'user']).not.toContain(cle);
    }
  });

  it('ne porte aucune valeur à deux mots : aucun fragment de phrase n’a fui', () => {
    for (const session of jeuReel()) {
      for (const valeur of [session.id, session.project, session.branch, session.startedAt, session.endedAt]) {
        expect(valeur.trim().split(/\s+/).length).toBeLessThanOrEqual(2);
      }
      expect(etiquetteModele(session.model).includes(' ')).toBe(false);
    }
  });

  it('classe les sessions par projet et par modèle, jamais par personne', () => {
    const resume = summariseClaudeCode(jeuReel());
    expect(resume.projets.length).toBeGreaterThan(1);
    expect(resume.modeles.length).toBeGreaterThan(1);
    expect(JSON.stringify(resume)).not.toMatch(/nom|prenom|surname|email|login/i);
  });
});
