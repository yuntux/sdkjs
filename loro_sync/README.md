# EuroOffice Loro Sync (P2P CRDT pour ONLYOFFICE)

Ce répertoire `loro_sync/` contient l'ensemble du code, des tests et de l'environnement de développement nécessaires pour remplacer le backend de coordination d'ONLYOFFICE par une architecture décentralisée basée sur Loro (CRDT).

## Audit de Licence (Phase 0.4)

⚠️ **Important :** Ce projet modifie et s'interface avec `sdkjs`, qui est publié sous **AGPLv3** par Ascensio System SIA (ONLYOFFICE).

*   **Loro** : Publié sous licence **MIT** / **Apache-2.0** (compatible et intégrable sans restriction virale stricte).
*   **Notre Code (`loro_sync`)** : Puisqu'il est lié au code source de `sdkjs`, le livrable final (le client modifié et le code d'interception) hérite automatiquement des obligations de la licence **AGPLv3**.
*   **Conséquence** : Toute modification apportée ici et déployée sur un serveur (même en mode SaaS) **doit être mise à disposition sous AGPLv3**. Le code source complet devra être accessible aux utilisateurs finaux de l'application.

## Commandes de Développement

```bash
cd loro_sync
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml exec dev-env bash
```
