# CLIENTS-AGENTS — un deuxième client réel, dans le vocabulaire du contrat

L'app ne doit plus connaître qu'OpenCode. Ce lot ajoute **Claude Code** comme
seconde source de faits réels, sur le même modèle que le lot O1 : une récolte
hors CI qui lit la source vivante, un jeu versionné anonymisé, un module pur
qui transforme ce jeu en `SessionReelle`, et des tests qui assertent les
chiffres du fichier versionné.

| Brique | Rôle |
| --- | --- |
| `tools/claude-code/source-jsonl.mjs` | le seul morceau qui touche à `~/.claude/projects` : lecture des `.jsonl`, regroupement par `sessionId`, règles d'anonymat |
| `tools/claude-code/harvest.mjs` | agrège par session, hache, trie, contrôle l'anonymat, écrit le jeu (hors CI, sans réseau) |
| `src/sample/claude-code-real.json` | le jeu versionné : 388 sessions, une par ligne, octets stables |
| `src/collect/claude-code.ts` | module pur : le jeu → `SessionReelle` du contrat (§3 « lecteur des sessions d'un client autre qu'OpenCode ») |
| `tests/collect/claude-code.test.ts` | les chiffres réels du jeu, avec effectifs et fourchettes, plus les cas limites |

Reproduire : `node tools/claude-code/harvest.mjs --dry-run` affiche le résumé
sans rien écrire ; sans `--dry-run`, il réécrit `src/sample/claude-code-real.json`.
Deux passages donnent des octets identiques (`generatedAt` est dérivé des
données, jamais de l'horloge).

## Ce que le deuxième client apporte

Mesuré à l'instant sur `~/.claude/projects` (428 fichiers `.jsonl`) :

- **59 044 lignes** lues, dont 1 illisible et **598 sans `sessionId`**
  (1,01 % [0,94 ; 1,10]) — écartées, pas comptées ;
- **388 sessions distinctes**, chacune avec une clé publique `cc_` + 16 hex,
  triées et sans doublon ;
- **jetons réellement déclarés** par le client : 29 022 d'entrée fraîche,
  40 378 343 de sortie, 90 925 821 créés dans le cache, 3 400 015 548 relus
  depuis le cache. Le contrat ne porte qu'un champ `jetonsEntree` : les trois
  quatrièmes parties y passent (le cache est consommé comme une entrée), moins
  29 022 + 90 925 821 + 3 400 015 548 = **3 490 970 391 jetons d'entrée**, et
  **3 531 348 734 jetons** une fois passés dans la session unifiée ;
- **durée** : 713 361 424 ms cumulés, soit **198,16 h** ; médiane 1 013 ms par
  session (une session de 28 h, 62 578 250 ms, tire la queue) ;
- **diversité** : 24 branches distinctes dans le flux (`HEAD` 19 741 lignes,
  `claude/tui-halloween-kiro-mascot-a22d4c` 3 148,
  `claude/crypte-pixel-art-design-222a11` 1 405), 59 répertoires distincts dans
  `cwd`. Le jeu versionné porte la branche **majoritaire** par session : 19
  branches et 31 projets relatifs ;
- **cinq modèles** distincts : `anthropic/claude-opus-5-5` (33 sessions),
  `anthropic/claude-sonnet-5-5` (84), `anthropic/claude-fable-5-2` (11),
  `anthropic/claude-haiku-5-5` (1), et `inconnu/inconnu` (259).

## Ce qui reste INCONNU

Rien de ce qui suit n'est un zéro : c'est `-1`, la règle du contrat §1
(« absent = `-1`, jamais `0` »), et un `-1` affiché est une conclusion.

- **le coût modèle** : le flux ne porte aucun prix facturé. Il porte 398 lignes
  `cost-state` avec un `totalCostUSD` **estimé localement** par la table de prix
  du client — pas une facture, pas en euros, et absent de l'immense majorité des
  sessions. Non retenu : `coutEuros = -1` pour les 388 sessions.
- **aucune liaison ticket** : `cleTicket = null` partout, donc
  **0 session rattachée sur 388** (0 % [0 ; 0,98]). Les 563 lignes `pr-link`
  portent un numéro de pull request, pas une clé de ticket, et un dépôt que le
  client nomme — hors périmètre, et personnel par nature.
- **21 315 lignes sur 59 044 sans timestamp** (36,10 % [35,71 ; 36,49]) : le
  flux en porte beaucoup qui ne sont pas horodatées (`mode`, `permission-mode`,
  `atis-latch`). Aucune **session** n'est privée d'horodatage pour autant :
  0 sur 388 (0 % [0 ; 0,98]) — chaque session compte au moins deux lignes
  datées, donc une durée mesurée.
- **259 sessions sur 388 n'ont aucune réponse de modèle** (66,75 %
  [61,92 ; 71,26]) : leur seule ligne `assistant` est une ligne d'erreur API
  (`isApiErrorMessage`, modèle `<synthetic>`), avec des jetons déclarés à zéro.
  Leur modèle est **inconnu** — `<synthetic>` n'est pas un modèle — mais leurs
  jetons sont **mesurés à 0**, pas absents : c'est exactement la distinction que
  la règle du `-1` protège. Les 129 restantes (33,25 % [28,74 ; 38,08]) portent
  un volume non nul.
- **aucun diff** : `ajouts`, `suppressions`, `fichiersTouches` valent `-1`. Les
  398 lignes `cost-state` déclarent `totalLinesAdded: 0` pour des sessions qui
  ont pourtant travaillé : ce champ ne dit rien de fiable.
- **ni titre, ni agent** : `titre` et `agent` sont vides. Le flux porte
  `custom-title`, `ai-title`, `agentName`, `last-prompt` — du texte libre de
  conversation, donc non exporté.

## La limite du contrat §3

**Une session d'un client ne dit pas quel commit elle a produit.** Claude Code
enregistre l'horodatage, les jetons, la branche et le répertoire de travail ; il
n'enregistre ni le commit, ni la clé de ticket, ni un diff rattaché à ces lignes.
Le rapprochement par proximité temporelle est justement ce que le contrat §2
interdit de présenter comme un fait : il n'est acceptable que **marqué**
(`attribution: 'fenetre'`), et il n'y a ici aucune marque à poser — donc
`attribution: 'aucune'` sur les 388 sessions, sans exception.

Ce qui rend l'attribution possible appartient à d'autres briques :
`src/collect/git-history.ts` (l'historique réel du dépôt : commits, diffs,
mentions d'agent, dates) et `src/collect/diffs.ts` (le rattachement). Deux
sources qui se croisent dans la session unifiée, jamais une interpolation.

## Les prompts ne quittent jamais la machine

Le dépôt est **public** et ces 388 sessions sont des conversations personnelles.
Ce n'est pas une option et ce n'est pas une promesse verbale : la récolte
n'exporte qu'une liste fermée de champs — id haché, projet relatif, modèle,
quatre volumes de jetons, durée, deux dates ISO, branche, `issueKey` à `null`,
`costEuros` à `-1` — et **refuse d'écrire** si une valeur de sortie tombe sous
`contientDonneePersonnelle()` (email, `/home/`, `/Users/`, UUID brut, empreinte
longue, clé d'API, identifiant de message, valeur `<synthetic>`, login de la
machine, ou un texte de plus de deux mots). Une clé interdite (`text`,
`content`, `prompt`, `title`, `message`, `cwd`, `user`, …) lève la même refus.

Un seul texte oublié est une fuite irrémédiable : il serait dans l'historique
git, pas seulement dans le dernier commit. Le contrôle est donc dans l'outil qui
écrit, pas dans une revue humaine du diff — `tests/collect/claude-code.test.ts`
répète le contrôle sur le fichier versionné à chaque exécution de la suite.

## Ce que ça change dans l'app

Le vocabulaire reste celui de `src/collect/session-reelle.ts` : un seul
`Client`, un seul `Modele`, une seule `Attribution`, un seul `INCONNU`.
`depuisClaudeCode(session)` rend une `SessionReelle` comme `depuisOpenCode` ;
les modules du domaine (`coverage`, `data-quality`, `machine-cost`, …) n'ont
aucune raison de savoir lequel des deux clients a produit une ligne. Ajouter un
troisième client (Codex, Copilot) = un outil de récolte et un adaptateur de
plus, rien de plus.
