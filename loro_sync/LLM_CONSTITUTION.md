# 🤖 Constitution & Mémoire pour les Agents LLM (EuroOffice × Loro)

> **À l'attention de tout agent IA (Claude, GPT, Gemini, Cursor, etc.) travaillant sur ce dépôt :** 
> Vous assistez un développeur Solo / Tech Lead sur le projet "EuroOffice", qui vise à remplacer le backend centralisé d'ONLYOFFICE par une architecture CRDT P2P et Local-First basée sur **Loro**. 
> **LISEZ ATTENTIVEMENT CES RÈGLES AVANT D'ÉCRIRE LA MOINDRE LIGNE DE CODE.**

---

## 🛑 Règle n°1 : L'Isolation Absolue (Dossier `loro_sync`)
Le dépôt `sdkjs` est un monolithe legacy très complexe. Pour faciliter les futures mises à jour (via `git pull` de l'upstream) et éviter les conflits :
1. **VOUS NE DEVEZ PAS MODIFIER LE CODE EXISTANT DE `sdkjs`** (sauf exception absolue et explicite du Tech Lead).
2. **Tout votre travail** (code métier, tests, documentation, scripts de build) doit être créé **exclusivement à l'intérieur du dossier `loro_sync/`**.
3. **Comment intercepter le code existant ?** Les "hooks" sur les classes ONLYOFFICE (`CParagraph`, `CRun`, etc.) doivent se faire par **Monkey-Patching dynamique** au moment de l'exécution, depuis des scripts situés dans `loro_sync/`.

## 🧪 Règle n°2 : Tests Unitaires Obligatoires
L'architecture CRDT ne pardonne pas les erreurs de synchronisation.
1. Chaque fois que vous complétez ou ajoutez une fonction (surtout pour le mapping OOXML ↔ Loro), vous **DEVEZ** écrire le test unitaire associé dans `loro_sync/tests/`.
2. Les tests doivent spécifiquement cibler la convergence : simuler des opérations concurrentes locales et distantes, et vérifier que le résultat final est identique.

## 🧹 Règle n°3 : Code Factorisé et Typé
1. Ne produisez pas de code "jetable" ou de gros blocs de if/else imbriqués.
2. Utilisez **TypeScript** (pour le client) et **Rust** (pour le serveur relais) de manière stricte.
3. Factorisez au maximum : créez de petites fonctions pures, des classes bien définies (ex: `LoroDocumentAdapter`, `MutationGuard`). 
4. Si vous vous répétez, abstrayez la logique.

## 📚 Règle n°4 : Documentation des Choix
Vous prenez souvent des décisions architecturales complexes (mapping d'index, gestion des offsets UTF-8 vs UTF-16, etc.).
1. N'enfouissez pas cette logique uniquement dans les commentaires du code.
2. Tout choix majeur doit être documenté en Markdown dans `loro_sync/docs/` (ou équivalent). Le Tech Lead doit pouvoir comprendre *pourquoi* vous avez codé ainsi.

## 🗺️ Règle n°5 : Suivi de la Feuille de Route
1. Avant de proposer de nouvelles fonctionnalités, consultez toujours `feuille_de_route_loro_onlyoffice.md` (situé dans `loro_sync/`) pour savoir à quelle phase se trouve le projet.
2. Ne vous dispersez pas : résolvez le problème immédiat de la phase en cours.

---

### Résumé de l'Architecture Cible
- **Client Web/Desktop** : Moteur `sdkjs` + pont `loro-crdt` compilé en WASM. Interception des deltas via Monkey-Patching.
- **Serveur Relais** : Écrit en Rust (Axum/Tokio). Il agit comme un pur relais WebSocket/WebRTC apatride et maintient un append-only log pour la persistance locale ou l'envoi de snapshots sur Seafile.
- **P2P Hors-Ligne** : Découverte via Node.js (mDNS/Bonjour) + WebRTC DataChannels locaux (Phase 7).

*Si vous avez compris ces règles, confirmez au Tech Lead que vous êtes prêt à procéder, et appliquez-les strictement pour toute génération de code.*
