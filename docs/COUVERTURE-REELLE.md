# La couverture réelle et la qualité de la donnée

> Lot « couverture réelle + qualité de la donnée ».
> Modules : `src/domain/coverage.ts`, `src/domain/data-quality.ts`.
> Tests : `tests/domain/coverage.test.ts`, `tests/domain/data-quality.test.ts`
> (sur le jeu réel versionné, jamais sur une fixture fabriquée pour l'occasion).
> Source des chiffres : `src/sample/opencode-real.json` — **865 sessions**
> récoltées sur ce poste du 21 septembre au 13 novembre 2026 (39 jours
> d'activité), parsées par `parseDataset` de `src/collect/opencode.ts`.
> Toutes les parts sont des proportions de Wilson (`src/domain/stats.ts`,
> z = 1,96) portées par leur effectif : aucun chiffre nu dans ce document.

## 1. Ce que le lot mesure

Deux questions, et rien d'autre :

- **couverture** : sur la matière réellement disponible, combien de sessions
  sont connues, combien sont rattachées à un ticket, comment elles se
  répartissent, et quelle part ne dit rien du code produit ;
- **qualité** : quelles lacunes ces sessions portent-elles, combien de fois,
  et est-ce qu'il reste assez de matière intacte pour décider.

| Ce que l'on veut savoir | Ce que la donnée dit | Nature du chiffre |
| --- | --- | --- |
| Combien de sessions sont connues | **865** | mesuré |
| Combien sont rattachées à un ticket | **25 sur 865** → 2,89 % (1,97 % – 4,23 %) | mesuré, intervalle de Wilson |
| Combien n'ont aucun ticket connu | **840 sur 865** → 97,11 % (95,77 % – 98,03 %) | mesuré, intervalle de Wilson |
| Combien ne disent rien du code produit | **0 sur 865** → 0 % (0 % – 0,44 %) | mesuré — et à ne pas lire comme « tous les diffs sont connus » |
| Combien de sessions sont intactes (aucune lacune) | **745 sur 865** → 86,13 % (83,66 % – 88,27 %) | mesuré, intervalle de Wilson |
| La matière reste-t-elle exploitable | **non : à manier avec prudence** | conclusion, sous le seuil documenté de 90 % |
| Combien de projets distincts | **5 sur 865 sessions** | mesuré |
| Combien de modèles distincts | **20 sur 865 sessions** | mesuré |

Les deux modules sont **purs** (CONTRATS-REALITE §4.1) : aucune horloge, aucun
disque, aucun réseau. Les sessions arrivent en paramètres, la sortie est une
valeur. La preuve en direct sur la base vivante reste dans
`tools/prove-real.mjs`, pas dans la suite de tests.

## 2. Les chiffres réels

### 2.1 La couverture du jeu versionné

| Grandeur | Valeur | Effectif / fourchette |
| --- | --- | --- |
| Sessions connues | 865 | mesuré |
| Rattachées à un ticket | 25 → 2,89 % | 1,97 % – 4,23 % sur 865 |
| Sans ticket connu | 840 → 97,11 % | 95,77 % – 98,03 % sur 865 |
| Clés de ticket distinctes | 5 (`PROJ-101` … `PROJ-105`) | mesuré, sur les 25 sessions rattachées |
| Sessions au code produit inconnu (`-1`) | 0 → 0 % | 0 % – 0,44 % sur 865 |

**25 sessions rattachées sur 865** : c'est la part de la matière sur laquelle
l'app pourrait adosser une preuve de ticket. Les 840 autres ne portent aucun
ticket connu — elles ne sont pas « sans ticket », elles sont **sans ticket
relevé** par ce collecteur.

### 2.2 Par projet (5 projets, 865 sessions)

| Projet | Sessions | Part du corpus | Intervalle de Wilson |
| --- | ---: | ---: | ---: |
| `Bureau` | 708 | 81,85 % | 79,14 % – 84,28 % |
| `home` | 109 | 12,60 % | 10,55 % – 14,98 % |
| `Bureau/opencode-lab` | 26 | 3,01 % | 2,06 % – 4,37 % |
| `Bureau/cardwake` | 20 | 2,31 % | 1,50 % – 3,54 % |
| `Bureau/creux` | 2 | 0,23 % | 0,06 % – 0,84 % |
| **Total** | **865** | 100 % | — |

Les parts sont triées par effectif décroissant, puis par clé : l'ordre **ne
dépend pas de l'ordre d'arrivée** des sessions, ce qui est vérifié par un test
dans les deux sens.

### 2.3 Par modèle (20 modèles, 865 sessions)

| Modèle | Sessions | Part | Intervalle de Wilson |
| --- | ---: | ---: | ---: |
| `opencode/space-bunny-free` | 366 | 42,31 % | 39,06 % – 45,63 % |
| `opencode/muse-spark-1.3-contributor-free` | 254 | 29,36 % | 26,43 % – 32,49 % |
| `modèle inconnu` | 76 | 8,79 % | 7,08 % – 10,86 % |
| `inferhub/combo/cheap` | 55 | 6,36 % | 4,92 % – 8,19 % |
| `opencode/deepseek-v4.1-flash-free` | 37 | 4,28 % | 3,12 % – 5,84 % |
| `agnes/agnes-3.0-flash` | 23 | 2,66 % | 1,78 % – 3,96 % |

Six lignes sur les **20 modèles distincts** du corpus ; les 14 autres portent
de 1 à 14 sessions chacun (54 sessions au total, sur les 865). **76 sessions
sur 865** (8,79 %, 7,08 % – 10,86 %) n'ont ni fournisseur ni identifiant de
modèle : le module les nomme `modèle inconnu`, il ne les jette pas et ne les
devine pas.

### 2.4 Les anomalies de la donnée (865 sessions)

| Anomalie | Sessions concernées | Part | Intervalle de Wilson |
| --- | ---: | ---: | ---: |
| `sans-agent` — aucun agent déclaré | 76 | 8,79 % | 7,08 % – 10,86 % |
| `sans-jetons` — entrée + sortie mesurées à 0 | 97 | 11,21 % | 9,28 % – 13,49 % |
| `duree-nulle` — durée mesurée à 0 ms | 3 | 0,35 % | 0,12 % – 1,01 % |
| `duree-aberrante` — plus de 12 h | 23 | 2,66 % | 1,78 % – 3,96 % |
| `diffs-inconnus` — un champ à `-1` | 0 | 0 % | 0 % – 0,44 % |

Les 23 sessions de plus de 12 h vont de **13,23 h à 45,99 h** (165 569 949 ms
pour la plus longue, sur 865 sessions) : une session de quarante-six heures
n'est pas une session de travail, c'est une base mal lue ou une machine laissée
allumée. Elle reste comptée, comme **lacune**, pas comme durée.

### 2.5 Le verdict

**745 sessions saines sur 865**, soit **86,13 %**, entre **83,66 %** et
**88,27 %**. Le seuil documenté est `PART_MIN_SAINES = 0.9`, soit **90 %** des
sessions au moins, sur l'estimation ponctuelle. La matière réelle du jeu est
donc **à manier avec prudence** — et toute la fourchette reste sous le seuil,
si bien que le verdict ne tient pas à un arrondi.

## 3. Comment ces chiffres se lisent

1. **Absent = `-1`, jamais `0`** (CONTRATS-REALITE §1). Une session dont le
   diff n'est pas connu porte `ajouts = -1` et compte dans `diffs-inconnus` ;
   une session dont le diff est **mesuré à zéro** ne porte aucune lacune. Les
   deux sont différents, et le module ne les additionne jamais.
2. **Une anomalie n'est pas une partition.** Une session peut porter plusieurs
   lacunes : sur les 865 sessions, les effectifs somment à **199 lignes
   d'anomalie pour 120 sessions atteintes** (865 − 745), soit **13,87 %** de la
   matière (intervalle 11,73 % – 16,34 % sur 865). Additionner les anomalies
   pour annoncer « 23 % de matière sale » serait un mensonge : et **76 sessions
   sur 865** (8,79 %, 7,08 % – 10,86 %) portent deux lacunes ou plus.
3. **Le seuil se lit sur l'estimation ponctuelle**, pas sur la borne haute de
   l'intervalle. Sur un échantillon de 10 sessions dont 8 sont saines, la part
   est de 80 % (intervalle 49,02 % – 94,33 %) : la borne haute dépasse 90 %,
   le verdict reste prudent. Un verdict tiré de la borne haute s'inverserait
   sur des échantillons minuscules.
4. **Rien n'est mesuré n'est pas « 0 % ».** Sur une liste vide, `proportion()`
   rend `n = 0`, `ciLow = 0`, `ciHigh = 1` : l'intervalle couvre tout, donc le
   module n'affirme ni 0 % ni 100 %. Le verdict sur matière vide est
   **prudent** — jamais « exploitable par défaut ».
5. **La durée aberrante est bornée exclusive** : 12 h pile
   (`DUREE_ABERRANTE_H = 12`) n'est pas aberrante, 12 h + 1 ms l'est. Le test
   tient les deux bouts.

## 4. Ce que la donnée NE DIT PAS

C'est la section qui compte le plus. Chacune de ces lignes est vérifiée par un
test, pas seulement écrite ici.

- **Aucun bras humain observé.** Les 865 sessions du jeu viennent d'un client
  agent (`source: opencode`). Rien, dans ces 865 lignes, n'atteste qu'une
  personne ait tenu ou non un clavier : ni frappe, ni éditeur, ni session
  humaine récoltée. Le lot ne peut donc **pas** opposer « agent » et « humain »
  — il décrit la matière disponible, pas l'origine des gestes.
- **Aucune issue mesurée.** Une clé de ticket rattache une session à un
  ticket ; elle ne dit **ni** si le ticket a été livré, **ni** s'il a été
  accepté, **ni** s'il a été résolu. Les 25 sessions sur 865 rattachées à une
  clé (2,89 %, 1,97 % – 4,23 %) sont une part de **rattachement**, pas un taux
  de réussite.
- **Un seul client agent connu.** OpenCode est le seul collecté dans le jeu
  versionné : `claude-code`, `codex`, `copilot` valent `inconnu` ici. La
  couverture du **poste** n'est donc pas la couverture de l'**activité** : ce
  que les autres clients ont produit est absent des 865 sessions, pas nul.
- **Les diffs ne sont pas attribués.** Les **865 sessions sur 865** portent
  `ajouts = 0`, `suppressions = 0`, `fichiersTouches = 0` : la base de collecte
  d'OpenCode ne porte pas les diffs (CONTRATS-REALITE §2), et le collecteur a
  écrit des zéros **mesurés**. Le `0 %` de `diffs-inconnus` (0 % – 0,44 % sur
  865) veut donc dire « aucun champ à `-1` dans le jeu », **surtout pas**
  « tous les diffs sont connus ». Les seuls diffs réels du dépôt viennent de
  `tools/lab/real-runs.json` (5 sessions du bac à sable) et de l'historique
  git — c'est le lot `src/collect/diffs.ts`, pas celui-ci.
- **76 sessions sur 865 ne nomment pas leur agent** (8,79 %, 7,08 % – 10,86 %)
  et **76 sur 865 ne nomment pas leur modèle** (mêmes bornes). Ce que la base
  ne déclare pas, le module ne l'invente pas : il le compte.
- **Pas de causalité, pas de contrefactuel.** Ces chiffres décrivent ce qui a
  été récolté. Ils ne disent rien de ce qu'un autre agent, ou personne, aurait
  produit à la place sur les 865 sessions.
- **Jamais par personne** (DP-17, CONTRATS-REALITE §4.4). Ni dans les modules,
  ni dans les tests, ni ici : aucune clé de répartition n'est un individu. Les
  seules dimensions sont le projet, le modèle, le ticket et la lacune.
- **Un poste, 39 jours, une récolte.** Les 865 sessions viennent d'une seule
  machine sur 39 jours (du 21 septembre au 13 novembre 2026). Rien ici
  n'autorise une extrapolation à une équipe, à un trimestre ou à un autre
  poste.

## 5. Ce que le lot expose

```ts
couvertureReelle(sessions)   // sessions, avecTicket, sansTicket, tauxTicket,
                             // partInconnue, parProjet, parModele
qualiteDonnee(sessions)      // sessions, anomalies[], saines, partSaines, verdict
ANOMALIES                    // ordre figé : sans-agent, sans-jetons, duree-nulle,
                             // duree-aberrante, diffs-inconnus
DUREE_ABERRANTE_H = 12       // borne exclusive
PART_MIN_SAINES = 0.9        // seuil du verdict
```

L'entrée est `SessionCouvrable` (`src/domain/coverage.ts`), sous-ensemble
structurel de la `SessionReelle` du contrat gelé (CONTRATS-REALITE §1) : mêmes
noms, mêmes types, une session du contrat s'y branche sans adaptation. Chaque
part sort de `proportion()` avec son `n` et ses deux bornes — la formule de
Wilson n'est réécrite nulle part (CONTRATS-REALITE §4.3).

## 6. Ce que ce lot ne fait pas

- **Il ne branche rien à l'écran.** `src/viewmodel/` et `site/` ne lisent pas
  encore ces deux modules : l'affichage se fait par un lot d'intégration, et
  `site/demo-data.json` se régénère à la fin, une fois (CONTRATS-REALITE §5).
- **Il ne collecte pas.** Aucun lecteur de base, aucun `git log`, aucun réseau
  : les modules sont purs et ne reçoivent que des paramètres. La collecte
  d'un autre client est `src/collect/claude-code.ts`, l'attribution des vrais
  diffs est `src/collect/diffs.ts`, l'historique git est
  `src/collect/git-history.ts` — trois autres lots.
- **Il ne juge pas un agent.** Le verdict porte sur la **matière** (assez
  intacte, ou pas), jamais sur la valeur du travail produit.
- **Il ne corrige pas les lacunes.** Une session de 45,99 h reste dans le
  corpus, marquée `duree-aberrante` : le lot signale, il ne nettoie pas.
