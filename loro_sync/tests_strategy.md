# Stratégie de Tests Industrielle (Loro ↔ ONLYOFFICE)

L'architecture P2P/CRDT reposant sur la synchronisation de registres plats et l'interception de flux internes (`arrayChanges`), la qualité du code ne peut être garantie que par une stratégie de tests automatisée drastique.

Cette stratégie s'articule autour de 4 piliers fondamentaux :

## 1. Tests Unitaires : L'Isolation du Mapper (Vitest)
Le cœur de la synchronisation est la traduction des codes magiques d'ONLYOFFICE vers les structures Loro (`ArrayChangesMapper.ts`). Ce composant **ne doit avoir aucune dépendance au DOM ou au Canvas**.
*   **Approche** : Injection de "Mocks" représentant des objets `arrayChanges` réels capturés.
*   **Assertion (Aller)** : Vérifier que `[ { "Type": 58, "Id": "tab_1" } ]` modifie bien la propriété `colspan` du `LoroMap` cible.
*   **Assertion (Retour)** : Simuler une mise à jour distante Loro et vérifier que la méthode `loroEventToArrayChanges()` recrée l'exact tableau attendu par ONLYOFFICE.

## 2. Tests de Convergence et de Résilience (Fuzzing)
Le principe mathématique du CRDT garantit que `Si A et B appliquent les mêmes événements dans le désordre, l'état final est identique` (*Strong Eventual Consistency*). Il faut le prouver.
*   **Fuzz Testing** : Un script automatise des milliers de modifications aléatoires concourantes (insertions, suppressions, formatages) sur deux instances Loro locales (sans UI ONLYOFFICE) avec une latence réseau simulée.
*   **Validation** : À la fin du script, le registre `nodes` de l'instance A doit être rigoureusement identique au registre de l'instance B, sans aucun conflit levé.

## 3. Tests End-to-End Visuels (Playwright)
C'est le test final du pont complet : de l'interface utilisateur (UI) jusqu'au réseau.
*   **Topologie de Test** : Déploiement local d'un Routeur Rust léger + lancement de 3 navigateurs Chromium headless via Playwright (Alice, Bob, Charlie).
*   **Scénario typique (Le test du conflit croisé)** :
    1. Alice clique sur un paragraphe et commence à taper.
    2. Bob sélectionne ce même paragraphe et le met en Rouge.
    3. Charlie insère une image au-dessus.
*   **Assertions** :
    *   Le Mutation Guard (Anti-écho) ne s'est pas bloqué.
    *   La méthode `FromToJSON` exécutée sur le client d'Alice retourne la même structure DOM que sur le client de Bob.
    *   **Test VRAM (Lazy Loading)** : Scroller un document de 100 pages rempli d'images générées via Playwright et mesurer la consommation mémoire du thread de rendu pour valider le comportement du `lazyImageLoader.ts` (Frustum Culling).

## 4. Tests de Partition Réseau (Chaos Engineering)
Simulation du scénario de "l'avion" décrit dans le document d'architecture.
*   **Déconnexion** : Le test débranche virtuellement l'accès réseau de l'instance de Bob (offline).
*   **Édition hors-ligne** : Bob édite massivement son document local.
*   **Reconnexion** : Rétablissement du réseau.
*   **Assertion** : Le Routeur Rust et les pairs doivent traiter un afflux massif de deltas asynchrones. Le document doit fusionner parfaitement sans faire crasher l'onglet du navigateur (`Out of Memory`).

---
**Règle d'or** : Aucun commit sur la traduction d'un nouveau type de nœud OOXML ne sera accepté sans son payload `arrayChanges` associé couvert par un test unitaire dans le Mapper.
