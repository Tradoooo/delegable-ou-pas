# Backtest sur l'historique réel

Le rejeu `src/domain/backtest.ts` reçoit les faits du graphe versionné et des périodes explicites. Il restitue les durées ouverture→merge observées des PR, les diffs comptables et les mentions d'agent. Ce constat historique ne prétend pas reconstituer une recommandation fiable : faute de bras comparateur, la sortie est `indeterminee` et le blocage `bras-comparateur-absent` est explicite. Chaque proportion porte son effectif et son intervalle Wilson ; une donnée absente reste `-1`.

## Mesures du jeu versionné

`src/sample/git-history-real.json` porte 92 commits et 111 PR récoltées ; 68 PR sont fusionnées et portent une durée mesurable. Leur durée ouverture→merge a une médiane de **0,196 h** (n=68, intervalle médian [0,064 h ; 0,300 h]) et s'étend de **0,016 h à 21,191 h** (n=68). Les commits comptent 519 entrées numstat et 403 fichiers distincts ; 6/92 mentionnent un agent. **0/92 commit ne porte de liaison ticket** : aucune cohorte par ticket ne se forme. La différence avec les chiffres 109/67 du relevé antérieur vient de la récolte versionnée ; le backtest et ses tests utilisent celle-ci comme source de faits.

## Ce que l'historique ne dit pas

Il ne dit pas quelle session a produit quel commit (contrat `docs/CONTRATS-REALITE.md` §2-3). Une proximité temporelle ne prouve pas une attribution. Il ne fournit donc ni durée de travail, ni bras humain/agent comparable, ni justesse par ticket. Les durées affichées sont celles des PR, pas celles des sessions. Les diffs sont ceux des commits, non attribués à des sessions. Aucune performance individuelle ni classement par personne n'est produit. Le résultat est une mesure honnête des observations disponibles et de leurs blocages, pas un verdict causal sur la délégation.
