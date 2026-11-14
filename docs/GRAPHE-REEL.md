# GRAPHE-REEL — le dépôt se mesure lui-même

Lot `lot/graphe-reel` (CONTRATS-REALITE.md §3, module `src/collect/git-history.ts`).
Le dépôt devient sa propre matière : son historique git est récolté **hors CI**
par `tools/git-history/harvest.mjs`, versionné anonymisé dans
`src/sample/git-history-real.json`, puis transformé en faits du domaine par un
module pur. Tous les chiffres de ce document sont ceux du jeu versionné, lu tel
quel par `tests/collect/git-history.test.ts` (30 tests). Aucun chiffre sans son
effectif ni sa fourchette ; les intervalles viennent de `proportion()` et de
`medianInterval()` de `src/domain/stats.ts`, jamais réimplémentés.

## 1. Ce que le dépôt apprend en se mesurant

| Fait | Mesure | Effectif | Fourchette |
| --- | --- | --- | --- |
| Diffs réels, comptés par git | 99 092 lignes ajoutées, 2 098 supprimées | 92 commits | 1 à 46 fichiers par commit |
| Matière du graphe | 519 entrées de `numstat`, 403 fichiers distincts | 519 entrées / 92 commits | — |
| Rythme du dépôt | médiane 0,284 h entre commits | 91 intervalles | [0,163 h ; 0,431 h] (intervalle de la médiane) |
| Amplitude du rythme | min 0,0006 h, max 16,27 h | 91 intervalles | étendue 71,30 h (2,97 jours) |
| Mentions d'agent | 6 commits dont le sujet porte un mot du catalogue | 6 sur 92 = 6,5 % | [3,0 % ; 13,5 %] |
| Liaisons de ticket | **0 commit ne porte de clé de ticket dans son sujet** | 0 sur 92 = 0 % | [0 % ; 4,0 %] |
| Mentions en prose | 7 commits citent `PROJ-207` ou `PROJ-412` dans leur corps | 7 sur 92 = 7,6 % | [3,7 % ; 14,9 %] |
| Signatures d'agent | 0 ligne `Co-authored-by:` | 0 sur 92 | [0 % ; 4,0 %] |
| Ouverture→merge des PR | médiane 0,196 h | 68 PR fusionnées sur 111 | [0,064 h ; 0,300 h] ; min 0,016 h, max 21,19 h |
| PR évoquant un agent | 48 PR dont le titre ou la branche porte un mot du catalogue | 48 sur 111 = 43,2 % | [34,4 % ; 52,5 %] |
| PR portant une clé de ticket | **0** | 0 sur 111 = 0 % | [0 % ; 3,4 %] |

Le catalogue de récolte est versionné avec le jeu (`catalogueAgent`) :
`agent`, `automerge`, `fireworks`, `mergify`. Sur ce dépôt, seuls `agent` (3
commits) et `mergify` (3 commits) rencontrent quelque chose ; les deux autres
mots valent 0 sur 92 commits.

## 2. La limite mesurée : aucune liaison ticket ici

**0 commit sur 92 ne rattache son travail à un ticket.** Ce n'est pas un trou de
récolte, c'est l'état du dépôt : aucun sujet ne porte de `PROJ-`, aucun trailer
`Fixes`/`Closes` n'existe, et les 111 pull requests récoltées n’en portent pas
non plus (0 sur 111). Sept commits nomment un ticket **en prose** dans leur
corps — `PROJ-412`, `PROJ-207` — et une mention en prose ne rattache rien : le
module les compte séparément (`mentionsProse`) et ne les confond jamais avec
une liaison.

Conséquence directe pour l'app : les **cohortes réelles** (comparer « avec
agent » et « sans agent » ticket par ticket) restent à fonder sur un graphe qui
n'existe pas encore dans ce dépôt. Ce que l'historique d'ici permet de mesurer,
c'est le travail lui-même — lignes, fichiers, dates, mentions — pas le ticket
derrière. `rattachementTickets()` rend donc `attribution: 'aucune'` sur les 92
commits, et `attributionTicket()` ne rend **jamais** `'fenetre'` : une
proximité de date n'est pas une preuve (contrat §2).

## 3. Ce que l'historique ne dit pas (contrat §3)

`limitesGraphe()` rend dix limites, chacune portée par l'effectif qui la fonde.
La première est celle du contrat : **l'historique ne dit pas quelle session a
produit quel commit.** Le vocabulaire gelé le traduis : un commit converti en
`SessionReelle` par `sessionDepuisCommit` porte `client: 'inconnu'`,
`attribution: 'aucune'`, et `-1` — jamais `0` — sur le coût, les
jetons, les lignes, la durée de travail et le modèle. Le diff mesuré par git
appartient au commit, pas à une session : c'est la règle du `-1` appliquée à la
donnée, « on ne sait pas » est une conclusion.

Les autres limites, mesurées sur le jeu :

- **0 commit de fusion** sur 92 : l'histoire est linéaire (1 racine, 91 commits
  à un parent). Ailleurs, un merge ne porte aucun diff dans `git log --numstat`
  — le module rend alors `-1` sur les lignes et compte le fichier touché ;
- **0 fichier binaire** sur 519 entrées : ailleurs les lignes d'un binaire ne
  sont pas comptables, et le total du commit devient inconnu, pas nul ;
- **91 commits sur 92** ont une date d'auteur différente de leur date de commit :
  les rebases réécrivent le passé. La durée entre commits est donc une durée de
  **dépôt**, pas une durée de travail ; elle est indépendante de l'ordre
  d'arrivée des commits (le module trie lui-même) ;
- **1 dépôt, 2,97 jours d'histoire** : rien d'une cohorte d'équipe. Étendre à
  d'autres dépôts est un travail de récolte, pas de calcul.

## 4. Ce que la récolte garantit, et comment le rejouer

`harvest.mjs` écrit un jeu **trié, déterministe et anonymisé** : deux passages
sur le même commit produisent des octets identiques (`generatedAt` est dérivé de
la date de commit la plus récente du jeu, jamais de l'horloge) ; les
identifiants de commit sont tronqués au plus court préfixe unique (7
caractères ici) ; aucun nom d'auteur, aucun email, aucun login, aucun chemin
absolu n'entre dans le fichier — une garde finale (`verifierAnonymat`) refuse
d'écrire plutôt que de laisser fuir. Le corps des commits n'est pas versionné :
seules les clés de ticket qui y figurent sont retenues, comme mention.

Le mode par défaut ne fait **aucun réseau** : `git log --numstat` suffit. Les
pull requests ne sont récoltées qu'avec `--prs` et un jeton présent ; sans
récolte, `pullRequests` vaut `null` — « non récolté » — et `resumePrs()` rend
partout `-1`, jamais « 0 PR ». C'est la distinction du contrat §1, tenue jusque
dans l'absence de récolte.

```bash
node tools/git-history/harvest.mjs --dry-run          # lit le git, rien n'écrit
node tools/git-history/harvest.mjs                    # écrit src/sample/git-history-real.json
node tools/git-history/harvest.mjs --prs              # + les PR via l'API GitHub (hors CI)
```

Aucun test n'appelle `git` ni l'API : la donnée réelle est le fichier versionné,
lu tel quel (contrat §4.5). La boucle est donc close — le dépôt s'est mesuré
lui-même, et la suite vérifie que la mesure n'a pas bougé.
