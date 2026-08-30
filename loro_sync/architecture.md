# Architecture : Intégration Loro CRDT × ONLYOFFICE (EuroOffice)

## 1. La Décision Architecturale Fondamentale

**L'objectif :** Obtenir des clients Web et Desktop 100% fonctionnels et hors-ligne, basés sur le moteur de rendu ONLYOFFICE, mais synchronisés via Loro CRDT (P2P) à la place du serveur centralisé classique.

### Le faux problème du parseur `.docx`
Il est important de comprendre que le moteur JS d'ONLYOFFICE (`sdkjs`) **ne parse pas nativement les fichiers `.docx`**. Cette tâche complexe est déléguée à un parseur C++ (`x2t`) qui s'exécute :
- **Sur le serveur** pour la version Web classique (via Document Server).
- **En local** pour la version Desktop (via la librairie native embarquée).
- **Dans le navigateur** via WebAssembly (`core.wasm`) dans certaines déclinaisons.

### La Solution Élégante
**On garde les clients officiels (Web et Desktop) intacts !** 
Ils continueront de gérer l'ouverture, la sauvegarde et l'export PDF du `.docx` avec leurs propres bibliothèques C++ (`x2t` ou `wasm`).
Notre seule intervention consiste à **arracher le "tuyau réseau" (DocsCoApi)** qui les relie normalement au Document Server d'ONLYOFFICE, pour y brancher notre couche de synchronisation **Loro CRDT**.

```mermaid
graph TD
    subgraph Client Officiel (Web ou Desktop Editors)
        UI[Interface Utilisateur / Ruban]
        Parser[Parseur C++ x2t / wasm]
        SDKJS[Moteur sdkjs - DOM Interne]
        DocsCoApi[DocsCoApi - Couche Réseau interceptée]
    end

    subgraph Loro Sync Layer (Notre travail)
        Adapter[LoroDocumentAdapter]
        CRDT[Moteur Loro WASM / Rust]
    end

    subgraph Réseau
        WebRTC[WebRTC / mDNS P2P]
        Relay[Relais léger Rust optionnel]
    end

    DOCX[(Fichier .docx)] <-->|Ouverture / Sauvegarde| Parser
    Parser <-->|Conversion en .bin/.json| SDKJS
    UI <--> SDKJS
    SDKJS <-->|Interception des changements OT| DocsCoApi
    DocsCoApi <-->|Traduction| Adapter
    Adapter <--> CRDT
    CRDT <-->|Diffusion des deltas CRDT| WebRTC
    CRDT <-->|Diffusion des deltas CRDT| Relay
```

---

## 2. Pourquoi Loro est le candidat idéal ?

Le choix de Loro CRDT n'est pas anodin face à Yjs ou Automerge. ONLYOFFICE possède un arbre DOM très complexe.

1. **Movable Tree CRDT natif** : Déplacement concurrent de sections/tableaux sans cycles orphelins (le talon d'Achille de Yjs).
2. **Fugue CRDT (Texte riche)** : Les styles (gras, italique) sont gérés de manière fluide, sans entremêlement lors d'insertions concurrentes.
3. **Eg-walker & Lazy Loading** : Chargement quasi instantané (DocState en RAM, OpLog sur disque) limitant la consommation de mémoire (très pertinent pour une application Electron Desktop).
4. **Zéro serveur central requis** : Résolution déterministe hors-ligne (DAG + Horloges logiques Lamport).

---

## 3. Gestion des conflits hors-ligne (Scénario P2P "Dans le train")

Contrairement à Microsoft 365 (Cobalt) qui génère des fichiers de conflit (`_conflit.docx`) et nécessite une résolution manuelle, Loro garantit une fusion mathématiquement prouvée :

| Cas d'usage | Résultat de la fusion Loro |
|---|---|
| **Parties différentes** (90% des cas) | Fusion instantanée et propre. |
| **Même phrase** (Insertions concurrentes) | L'algorithme Fugue juxtapose le texte de manière déterministe. **Jamais de lettres entremêlées.** |
| **Propriété unique** (Couleur de fond) | **Last-Write-Wins** (Dernier qui écrit a raison) basé sur l'horloge logique Lamport. |
| **Déplacement structurel cyclique** | Si Alice bouge A dans B, et Bob bouge B dans A : LoroTree détecte le cycle et l'arbre ne casse jamais. |

### Visualisation des conflits (Track Changes)
Plutôt que d'imposer des fusions silencieuses qui pourraient altérer le sens d'un contrat, nous exploiterons la fonctionnalité **Track Changes** native d'ONLYOFFICE. 
Les deltas Loro reçus après une reconnexion P2P hors-ligne seront injectés comme des "Révisions" (`AddTrackChangeInsert`), permettant à l'utilisateur d'accepter ou rejeter la fusion visuellement.

---

## 4. Comparatif Serveur : Le saut d'échelle

En remplaçant le tentaculaire Document Server (Node.js, RabbitMQ, Redis, PostgreSQL) par la magie du CRDT (où l'intelligence est dans le client), l'infrastructure serveur optionnelle devient microscopique.

| Métrique | ONLYOFFICE Classique | Relais Rust + Loro |
|---|---|---|
| **Rôle du serveur** | Ordonnanceur, Arbitre, Convertisseur, Session. | Simple "Dumb" Relais WebSocket (Broadcaster). |
| **RAM / document actif** | ~150-250 Mo | **~1-2 Mo** |
| **RAM pour 100 docs** | 15-25 Go | **~150-300 Mo** |
| **RAM au repos** | ~2-3 Go | **~15-30 Mo** (Un seul binaire statique Alpine) |

---

## 5. Synthèse de l'Anatomie de sdkjs & Pipeline de Mutation

Le moteur JS interne reproduit le standard ECMA-376 (OOXML).
Le cycle de vie d'une frappe clavier est le suivant :

```mermaid
sequenceDiagram
    participant User
    participant DOM as sdkjs (DOM OOXML)
    participant Loro as DocsCoApi (Stub Loro)
    participant Canvas as Rendu Canvas

    User->>DOM: 1. Frappe au clavier (Action Command)
    DOM->>DOM: 2. Mutation de l'arbre (CRun.AddText)
    DOM->>Loro: 3. Génération d'un objet OT (arrayChanges)
    Note over Loro: Interception via nos hooks miroirs<br/>Traduction de l'OT vers delta Loro<br/>Diffusion aux pairs
    DOM->>DOM: 4. Flags de salissement (Dirty Flags = true)
    DOM->>Canvas: 5. Recalculate() & Draw()
```

Notre hook (déjà initialisé dans la Phase 1.2 avec `Injector.ts`) se situe exactement à l'étape 3. Nous attrapons les changements locaux avant qu'ils ne partent sur le réseau officiel, et nous alimentons notre CRDT pour diffuser l'information.

---

## 6. Structure des fichiers d'interception (Hooks)

Pour éviter de créer un fichier "God class" géant (`interceptor.ts`) qui deviendrait impossible à maintenir, **l'architecture des hooks doit strictement reproduire en miroir l'arborescence originale de sdkjs**. 

Chaque classe interceptée aura son fichier dédié dans notre répertoire `src/hooks/`.

**Exemple d'arborescence :**
```text
loro_sync/src/hooks/
├── word/
│   ├── Editor/
│   │   ├── Paragraph.ts    # Monkey-patch de window.CParagraph
│   │   ├── Run.ts          # Monkey-patch de window.CRun
│   │   └── Table.ts        # Monkey-patch de window.CTable
│   ├── Drawing/
│   │   └── Shape.ts        # Monkey-patch de window.CShape
│   └── document/
│       └── History.ts      # Monkey-patch du Undo/Redo
```
Cette règle garantit que notre code reste lisible, facilement testable de manière unitaire, et immédiatement compréhensible pour un développeur habitué au code source d'ONLYOFFICE.

---

## 7. L'Approche "Industrielle" (DOM-Mirroring Générique)

Pour éviter de devoir coder manuellement la synchronisation des *milliers* de propriétés spécifiques à OOXML (Gras, Italique, Marges, Rotation, Styles de bordure, etc.) qui pourraient changer à chaque mise à jour d'ONLYOFFICE, **notre `LoroDocumentAdapter` utilisera une approche totalement générique basée sur les IDs**.

### Le Registre Plat (Flat Node Registry)
Chaque élément dans `sdkjs` (du paragraphe à la forme vectorielle) possède un identifiant unique généré par le moteur : l'`InternalId`.
Dans le CRDT Loro, nous ne modélisons pas un arbre profond complexe avec des objets personnalisés imbriqués. Nous créons un registre plat couplé à un `LoroTree` :
`const nodes = doc.getMap("nodes");`
`const tree = doc.getTree("dom");`

### La Traduction Automatique et le Déplacement (Move)
*   **Création de nœud** : Lorsqu'un élément est instancié dans ONLYOFFICE, on crée génériquement une `LoroMap` (pour ses propriétés) avec la clé `InternalId`.
*   **Hiérarchie et Déplacement (LoroTree)** : L'arborescence du document (qui est le parent de qui) est gérée par la structure spécialisée `LoroTree`.
    *   Le moteur OT d'ONLYOFFICE n'a pas de commande "Déplacer". Il émet toujours une "Suppression" suivie immédiatement d'une "Insertion".
    *   Notre pont utilise un tampon heuristique (debounce de quelques millisecondes). S'il détecte un *Delete* et un *Insert* du même `InternalId` dans la même rafale de `arrayChanges`, il le traduit en un appel unique et atomique vers le CRDT : `tree.move(InternalId, NouveauParentId)`. Cela protège la sémantique de l'objet et évite sa recréation.
*   **Propriétés (Le secret industriel)** : Au lieu d'intercepter `SetBold()`, `SetRotation()`, etc., nous interceptons les mutations envoyées par ONLYOFFICE. Loro ne se soucie pas de ce qu'est la propriété, il synchronise juste des clés/valeurs JSON.
*   **Texte** : Seules les insertions de caractères appellent de manière spécifique `LoroText.insert()`.

**Avantage décisif (Le zéro-maintenance)** : Si ONLYOFFICE ajoute le support d'une nouvelle ombre 3D dans sa prochaine version, notre code n'aura *absolument pas* besoin d'être mis à jour. Loro synchronisera la nouvelle clé JSON de l'ombre 3D automatiquement.

### L'Élégance de l'interception (`arrayChanges` vs Monkey-Patching)

Lors de la phase de conception initiale, il avait été envisagé de surcharger (*monkey-patcher*) chaque méthode individuelle d'ONLYOFFICE (`SetBold()`, `MergeCells()`, `InsertTable()`, etc.). **Nous avons catégoriquement abandonné cette approche au profit du canal unique `arrayChanges` pour 3 raisons économiques écrasantes :**

1. **Rétro-ingénierie "Black-Box" instantanée** : Trouver la méthode `MergeCells` dans les 40 000 lignes du code legacy de sdkjs prend des heures. Avec `arrayChanges`, il suffit de cliquer sur "Fusionner" dans l'interface pour voir le JSON s'afficher dans la console : `[{"Type": 58, "Id": "cell_1"}]`. L'investigation prend 5 secondes.
2. **Le Volume de Code (1 Hook vs 500 Hooks)** : Intercepter manuellement nécessitait de coder, tester et maintenir des centaines de points d'injection (un par bouton). Avec l'approche actuelle, il y a **un seul point d'injection réseau**. L'extension se limite à un dictionnaire (`switch/case`).
3. **Le Batching (Atomicité gratuite)** : Si un utilisateur colle un énorme tableau, l'éditeur appelle nativement `CreateCell()` 1000 fois. Surcharger cette méthode aurait généré 1000 messages réseau (risque de saturation). Le moteur `arrayChanges`, lui, attend la fin du *Paste* et émet un seul Delta atomique pré-calculé. Le Diff et le Batching nous sont offerts gratuitement !

### Le Pont "Passe-Plat" (arrayChanges ↔ Loro)
Le système repose sur la traduction simultanée entre l'OT centralisé (ONLYOFFICE) et le CRDT décentralisé (Loro) via l'`InternalId` comme "plaque d'immatriculation" :

1. **Aller (Local vers Réseau P2P)** :
   - ONLYOFFICE calcule le delta via son système OT (`arrayChanges`). Ex: `[ { "Type": 14, "Id": "run_456", "Props": {"Bold": true} } ]`.
   - L'`Injector` intercepte ce tableau ultra-précis.
   - Le pont lit l'`Id` (`run_456`), retrouve la `LoroMap` correspondante dans le registre plat, et applique la modification.
   - Loro calcule mathématiquement la résolution de conflit (CRDT) et diffuse un micro-Delta binaire sur le réseau.
2. **Retour (Réseau P2P vers Local)** :
   - Le Loro distant reçoit le Delta et déclenche un événement `subscribe()`.
   - Le pont traduit l'événement Loro (ex: `"run_456" a vu "Bold" passer à true`) en recréant un faux objet `arrayChanges`.
   - Cet objet est injecté dans le moteur de rendu d'ONLYOFFICE qui l'ingère naturellement pour dessiner l'écran.

Cette double architecture permet d'avoir la robustesse de l'affichage d'ONLYOFFICE tout en bénéficiant de la magie hors-ligne et P2P du CRDT.

### 7.1 Gestion du Undo / Redo (Time-Travel Local)
Un défi majeur de la co-édition Temps Réel est la fonction "Annuler" (Ctrl+Z). Si Alice et Bob tapent dans le même paragraphe, et qu'Alice fait Ctrl+Z, le moteur natif d'ONLYOFFICE (pensé pour être centralisé) risque d'effacer les caractères que Bob vient de taper.
Pour résoudre cela, **nous désactivons le gestionnaire d'historique natif d'ONLYOFFICE**.
À la place, nous interceptons les événements clavier Ctrl+Z / Ctrl+Y (ou les clics sur les boutons de la barre d'outils) et nous les redirigeons vers l'API **Time-Travel de Loro** (`loro.undo()` / `loro.redo()`).
Loro étant un CRDT, son moteur d'Undo mathématique isole parfaitement les causalités : il va annuler exclusivement les frappes générées par le `peer_id` local d'Alice, sans jamais toucher aux caractères insérés par Bob au même endroit, garantissant une intégrité absolue.

---

## 8. Topologie Réseau et Cas d'Usage (Web vs Desktop)

Voici l'architecture globale en condition réelle : **Alice** utilise l'application Web d'EuroOffice depuis le réseau A, tandis que **Bob** travaille sur l'application native Desktop (Windows/Linux/Mac) depuis le réseau B. Ils collaborent sur le même document via Internet.

### Diagramme de Composants

```mermaid
graph TD
    subgraph "Alice (Réseau A - Navigateur Web)"
        A_UI[Canvas ONLYOFFICE]
        A_OT[Moteur OT arrayChanges]
        A_Pont[Injector + LoroAdapter]
        A_CRDT[Moteur Loro CRDT]
        A_UI <-->|Événements UI| A_OT
        A_OT <-->|JSON atomique| A_Pont
        A_Pont <-->|LoroMap/Text| A_CRDT
    end

    subgraph "Internet"
        Router((Routeur Rust<br/>WebSocket Relay<br/>zéro logique métier))
    end

    subgraph "Bob (Réseau B - Client Desktop)"
        B_UI[Canvas ONLYOFFICE]
        B_OT[Moteur OT arrayChanges]
        B_Pont[Injector + LoroAdapter]
        B_CRDT[Moteur Loro CRDT]
        B_CRDT <-->|LoroMap/Text| B_Pont
        B_Pont <-->|JSON atomique| B_OT
        B_OT <-->|Redessin| B_UI
    end

    A_CRDT <==>|Deltas Binaires| Router
    Router <==>|Deltas Binaires| B_CRDT
```

> **Note :** Les deux clients, bien que sur des plateformes différentes (Web vs Desktop), exécutent exactement la même couche JavaScript/WASM pour `sdkjs` et Loro. Le routeur central ne comprend rien au format Word, il se contente de relayer aveuglément les deltas binaires Loro d'un réseau à l'autre.

### Diagramme de Séquence (Alice tape un mot)

```mermaid
sequenceDiagram
    box Local Network A (Alice)
    participant AliceUI as ONLYOFFICE Web
    participant AliceCRDT as Pont + Loro
    end
    
    box Internet
    participant Routeur as Routeur Rust
    end
    
    box Local Network B (Bob)
    participant BobCRDT as Pont + Loro
    participant BobUI as ONLYOFFICE Desktop
    end

    AliceUI->>AliceUI: 1. Sélectionne le mot et clique sur "Gras"
    AliceUI->>AliceCRDT: 2. Génère arrayChanges: {Bold: true}
    AliceCRDT->>AliceCRDT: 3. Met à jour LoroMap.props(Bold)
    AliceCRDT-)Routeur: 4. Envoi du micro-Delta binaire
    Routeur-)BobCRDT: 5. Relayage (Broadcast) du Delta
    BobCRDT->>BobCRDT: 6. Fusion CRDT automatique
    BobCRDT->>BobUI: 7. Traduction en arrayChanges
    BobUI->>BobUI: 8. Rendu (Le mot devient gras sur l'écran)
```

---

## 9. Gestion des Objets Binaires (Images, DrawingML)

Les fichiers binaires lourds (images de 5 Mo, graphiques Excel intégrés) ne doivent **jamais** être stockés dans le CRDT Loro pour éviter d'exploser la RAM des clients (l'historique CRDT est immortel).

1. **Interception HTTP** : L'upload d'image (requête POST) généré par ONLYOFFICE est intercepté.
2. **Blob Store P2P** : Le fichier est envoyé à notre Routeur Rust (qui agit comme un serveur de fichiers statiques miniature).
3. **Ancrage Loro** : Le routeur renvoie un Hash/URL (ex: `blob:sha256:abc123`). Ce Hash est injecté dans le CRDT.
4. **Récupération** : Les autres pairs téléchargent l'image depuis le routeur de manière asynchrone pour l'afficher sur leur Canvas.
5. **Lazy Loading et Frustum Culling (Optimisation VRAM)** : Pour éviter le crash mémoire (OOM) sur les documents contenant des centaines d'images, notre pont intercepte la méthode `CImageDrawing.prototype.Draw`. L'image n'est téléchargée et décodée (`createImageBitmap`) **que** lorsque sa boîte englobante croise le viewport (l'écran visible) de l'utilisateur. Si l'image sort de l'écran, son buffer GPU est libéré (`bitmap.close()`).

Pour les clients Desktop, les chemins locaux (`file:///C:/temp/...`) sont de la même manière interceptés, uploadés en arrière-plan, puis remplacés par les URLs publiques avant d'être inscrits dans Loro.

---

## 10. Les 4 Limites et Défis de l'Architecture "Passe-Plat"

Malgré sa rapidité et son ingénierie générique, cette méthode de traduction OT ↔ CRDT soulève 4 défis techniques majeurs que nous devrons contourner.

### Limite 1 : Le "Cold Start" (Chargement initial du document)

*   **Le scénario du pire** : Charlie ouvre le document pour la première fois. Il reçoit l'historique CRDT Loro (qui contient par exemple 100 pages, soit 50 000 objets). L'outil `arrayChanges` étant conçu pour des micro-deltas, si notre pont devait forcer le moteur ONLYOFFICE à rejouer 50 000 événements `arrayChanges` consécutifs pour reconstruire le document, le thread JavaScript saturerait et le navigateur de Charlie figerait ou crasherait.

*   **La Solution retenue (Séparation Réseau / RAM)** :
    Grâce à l'approche "miroir" de notre registre plat, nous possédons la structure exacte d'ONLYOFFICE. Au lieu d'utiliser l'OT (`arrayChanges`) pour le démarrage, nous pratiquons une **sérialisation inverse** :
    1. **Étape 0 - L'Export par un pair actif (Alice)** : Lorsqu'un nouvel utilisateur (Charlie) souhaite rejoindre la session, un utilisateur déjà présent (Alice) appelle la méthode `LoroDoc.exportSnapshot()`. Le moteur Loro d'Alice génère instantanément le binaire compressé de 2 Mo et l'envoie au Routeur Rust.
    2. **Étape 1 - Le Téléchargement Binaire (Réseau)** : Charlie se connecte au routeur. On ne lui transmet **jamais** de gros JSON. Le réseau lui envoie uniquement ce **Snapshot Binaire Loro** de 2 Mo. La bande passante est préservée.
    3. **Étape 2 - Le Dépliage en RAM (Local)** : Le moteur WASM de Loro charge ce binaire dans la mémoire de Charlie. Immédiatement, le `LoroDocumentAdapter` de Charlie parcourt le registre plat et "déplie" l'arborescence (en liant les `children` et les `props`). Il génère ainsi à la volée un arbre JSON géant (le format `DOCY`). Cette opération purement locale prend environ 20 ms.
    4. **Étape 3 - L'Ingestion Native (ONLYOFFICE)** : Ce gros objet JSON (qui peut peser 50 Mo en mémoire vive) est passé directement à la méthode native `CDocument.FromJSON()` de SDKJS. ONLYOFFICE affiche le document d'un coup, sans utiliser le moindre `arrayChanges`, et le JSON temporaire est détruit par le Garbage Collector.

```mermaid
graph TD
    subgraph "Client Alice (Pair déjà connecté)"
        AliceLoro[Moteur Loro]
        AliceExport[Loro.exportSnapshot]
        AliceLoro -- "Génère" --> AliceExport
    end

    subgraph "Réseau Internet"
        Router((Routeur Rust))
        LoroBin[Snapshot Binaire Loro<br/>Ultra-compressé - 2 Mo]
        AliceExport -- "Upload WebSocket" --> Router
        Router -- "Met à disposition" --> LoroBin
    end
    
    subgraph "Client Charlie (Nouveau venu)"
        LoroRAM[Moteur Loro WASM]
        Bridge[LoroDocumentAdapter<br/>Sérialisation inverse]
        JSON[Arbre JSON complet<br/>~50 Mo]
        SDKJS[ONLYOFFICE sdkjs<br/>CDocument.FromJSON]
        Canvas[Rendu Visuel Instantané]
        
        LoroBin -- "Téléchargement" --> LoroRAM
        LoroRAM -- "Dépliage des InternalId (20ms)" --> Bridge
        Bridge -- "Génération" --> JSON
        JSON -- "Ingestion native" --> SDKJS
        SDKJS -- "Dessin" --> Canvas
    end
```

### Limite 2 : Le Phénomène d'Écho (Boucle infinie)
*   **Le problème** : Lorsqu'on applique un Delta entrant chez Bob (via `arrayChanges`), le moteur ONLYOFFICE de Bob réagit en générant lui-même un nouvel `arrayChanges` sortant (pour prévenir le réseau que son écran a changé). S'il est relayé, cela crée une boucle infinie de modifications.
*   **La Solution retenue (Le Mutation Guard)** :
    Nous devons implémenter un verrou (lock) asynchrone dans notre intercepteur (`Injector.ts`).
    1. Définir un flag global `isApplyingRemoteUpdate = false`.
    2. À la réception d'un Delta réseau : on passe le flag à `true`.
    3. On injecte le `arrayChanges` dans le moteur natif.
    4. L'intercepteur de ONLYOFFICE s'active et tente de faire un `saveChanges(arrayChanges)`.
    5. **Le Verrou** : Dans notre hook `saveChanges`, on ajoute la condition `if (isApplyingRemoteUpdate) return;`. La modification n'est donc pas renvoyée au réseau.
    6. Une fois le rendu terminé, on repasse le flag à `false`. L'écho est bloqué.

### Limite 3 : La perte de l'intention sémantique (Fusions complexes)
*   **Le problème** : L'OT d'ONLYOFFICE fragmente des opérations complexes (ex: fusionner deux cellules d'un tableau) en opérations de très bas niveau (déplacement de texte, suppression de bordure, etc.). Si un conflit P2P survient pendant cette opération, Loro pourrait entrelacer ces briques avec l'action d'un autre utilisateur, aboutissant à un tableau graphiquement corrompu.
*   **La Solution retenue (L'Approche Transactionnelle)** :
    Loro possède une fonction native de transactions (`doc.commit()`).
    Heureusement, ONLYOFFICE groupe toutes les micro-opérations d'une action utilisateur (comme "Fusionner") dans un seul et même tableau `arrayChanges`.
    Au lieu d'appliquer chaque élément de l'array isolément dans Loro, le pont ouvrira une Transaction Loro, appliquera toutes les modifications de l'array, puis fera un `commit()`. Ainsi, Loro traitera la fusion de cellules comme un **bloc atomique indivisible**, interdisant toute corruption de l'intention structurelle en cas de conflit.

### Limite 4 : La dépendance au protocole privé (Reverse-Engineering)
*   **Le problème** : L'objet `arrayChanges` n'est pas une API publique. ONLYOFFICE peut modifier sa structure de manière arbitraire (ex: renommer le code `Type: 14` en `Action: "Format"`) dans une future version, ce qui casserait instantanément notre pont.
*   **La Solution retenue (Le Fork et l'Isolation du Mapper)** :
    1. **Version Pinning** : Nous figeons la version de `sdkjs` (ex: `v8.1.0`) dans notre dépôt. Pas de mise à jour automatique.
    2. **Design Pattern Adapter** : Nous allons isoler TOUTE la logique de traduction des codes magiques (comme `Type: 14`) dans un seul fichier : `ArrayChangesMapper.ts`. 
    3. **Tests E2E Playwright** : Une suite de tests cliquera automatiquement sur les boutons de l'UI d'ONLYOFFICE (Gras, Insérer Tableau) et vérifiera que le `Mapper` génère la bonne structure Loro. Lors d'une montée de version d'ONLYOFFICE, si la syntaxe `arrayChanges` change, les tests exploseront instantanément, et il suffira de corriger cet unique fichier `Mapper` sans toucher au reste de l'architecture.

### Limite 5 : La Priorité Fichier vs Réseau (Cas du double-clic Desktop / Seafile)
*   **Le problème** : Si Bob double-clique sur un fichier `.docx` synchronisé par Seafile sur son bureau, l'application ONLYOFFICE Desktop charge d'abord le fichier local. Mais si Alice est *déjà* en train de modifier ce même document en ligne, comment le client de Bob le sait-il ? S'il injecte naïvement son `.docx` local dans son Loro, il va créer des doublons avec le document d'Alice (chaque paragraphe aura un ID différent dans les deux Loro).
*   **La Solution retenue (Le Handshake Réseau d'abord)** :
    L'architecture doit imposer une priorité stricte au démarrage :
    1. Bob ouvre le fichier. Le Canvas d'ONLYOFFICE affiche le `.docx` local.
    2. En tâche de fond, le pont de Bob contacte le Routeur Rust (avec un Room ID basé sur le hash du fichier).
    3. **Scénario A (Bob est seul)** : Le routeur répond "Salle vide". Le pont de Bob prend alors le `.docx` affiché à l'écran, génère la structure Loro initiale (de ONLYOFFICE vers Loro) et devient la "graine" (le *Seeder*) pour le réseau.
    4. **Scénario B (Alice est déjà là)** : Le routeur répond "Salle active" et envoie le Snapshot Loro d'Alice. Le pont de Bob **détruit** immédiatement l'état Loro et le Canvas local, charge le Snapshot d'Alice, refait un Cold Start (Loro ➔ JSON ➔ `FromJSON`), et le document à l'écran se met à jour magiquement avec les dernières frappes d'Alice.

---

## 11. Résilience et Partition Réseau (Le Scénario de l'Avion)

L'un des avantages majeurs de l'architecture CRDT (comparé à l'OT centralisé d'ONLYOFFICE ou de Google Docs) est sa capacité native à gérer les coupures réseau prolongées et les réseaux éclatés (Network Partitions).

### Le Scénario
1. **Dans l'avion (Réseau Ad-hoc P2P)** : Alice et Bob prennent un vol. Ils n'ont pas accès à Internet, mais ils se connectent en Wi-Fi local direct. Leurs moteurs Loro s'échangent les micro-deltas en P2P pur. Ils voient leurs modifications respectives en temps réel.
2. **Sur Terre (Internet)** : Charlie, resté au bureau, modifie le même document, seul, via le Routeur Rust.
3. **L'Atterrissage (La Réconciliation)** : Alice et Bob atterrissent et retrouvent la connexion 4G. Leurs clients se reconnectent au Routeur Rust central.
4. **La Fusion Mathématique** : Les Loro d'Alice et Bob envoient toutes les frappes accumulées pendant le vol au Routeur, qui les relaie à Charlie. Le CRDT utilise ses horloges de Lamport pour entremêler les textes d'Alice, Bob et Charlie de manière parfaitement déterministe. **Les trois collaborateurs finissent avec exactement le même document fusionné.**

### ⚠️ Le Piège de l'Origine (The Common Ancestor)
Pour que cette magie opère, **les clients doivent obligatoirement partager le même ancêtre Loro (historique racine)** avant la coupure réseau. 
Si Alice (dans l'avion) et Charlie (sur terre) prennent tous les deux un document `.docx` vierge et l'injectent **indépendamment** dans Loro (via le processus de *Seeding* décrit à la Limite 5), les moteurs vont générer des `InternalId` différents.
À l'atterrissage, Loro considèrera qu'il s'agit de deux documents totalement distincts et refusera de les fusionner.
*   **La Règle d'Or** : La résilience P2P fonctionne parfaitement à la condition stricte que le document ait été synchronisé au moins une fois (via son fichier caché `.loro` par exemple) avant la partition réseau, afin que tout le monde partage le même arbre d'identifiants.

### 11.1 L'Auto-découverte P2P (mDNS / Bonjour)
Dans ce scénario "Avion" (ou lors d'une coupure Internet d'entreprise), comment les clients d'Alice et Bob se trouvent-ils sur le réseau Wi-Fi local sans serveur central pour les mettre en relation ?
C'est ici que l'application **ONLYOFFICE Desktop Editor** déploie toute sa puissance. Contrairement au client Web (navigateur classique) qui est bridé par des règles de sécurité (sandbox), le Desktop Editor embarque un environnement **Node.js** complet (via Electron/CEF).
1. **Diffusion (Broadcast)** : Au lancement, notre pont Loro utilise les capacités réseau de Node.js pour diffuser un signal **mDNS** (Multicast DNS, technologie Bonjour/Avahi) sur le réseau local : *"Bonjour à tous, je suis en train d'éditer le document dont le Hash est XYZ sur mon port local 8080"*.
2. **Écoute et Connexion** : L'ordinateur de Bob écoute passivement le réseau local. Lorsqu'il capte ce signal mDNS correspondant au document qu'il essaie d'ouvrir, il ne cherche plus à joindre le Routeur Rust sur Internet. Il ouvre directement une connexion WebSocket locale vers l'IP de l'ordinateur d'Alice (`ws://192.168.1.55:8080`).
3. La salle de collaboration est ainsi recréée localement, de manière totalement invisible pour les utilisateurs !

---

## 12. Intégration Seafile et Sauvegarde (Le Callback)

L'intégration standard entre Seafile et ONLYOFFICE (via WOPI ou API native) repose entièrement sur l'existence d'un Document Server centralisé. 
Dans le fonctionnement classique :
1. Seafile donne l'URL du document au Document Server.
2. Le serveur héberge la session collaborative.
3. Quand tous les utilisateurs ont fermé leur onglet, le Document Server regénère le fichier `.docx` final et l'envoie à Seafile via une requête HTTP POST (callback) pour créer une nouvelle version du fichier.

### Le Changement de Paradigme avec Loro
Notre architecture **supprime purement et simplement le Document Server**, le remplaçant par un routeur Rust ultra-léger (qui ne fait que relayer des octets sans rien comprendre au format `.docx`). Le routeur ne peut donc pas générer le fichier de sauvegarde.

### La Solution (Le Client-Side Callback)
Puisque le serveur a disparu, la responsabilité de la sauvegarde bascule côté client (le navigateur ou le client Desktop) :
1. **Rendu Local** : Le client possède déjà le document complet affiché dans son Canvas ONLYOFFICE.
2. **Export Natif** : Le moteur `sdkjs` (exécuté dans le navigateur) possède nativement la logique binaire pour exporter un fichier `.docx` valide depuis son état en mémoire.
3. **Le Push vers Seafile** : C'est notre pont (l'application locale) qui, lorsqu'un utilisateur clique sur "Sauvegarder" (ou lorsque le dernier client quitte la session), demande à `sdkjs` de compiler le `.docx` et envoie directement ce fichier par un appel API HTTP POST (ou via le client de synchronisation Seafile Desktop) vers les serveurs de stockage.

**Avantage** : Cette décentralisation complète soulage l'infrastructure serveur, car la coûteuse compression/génération du fichier `.docx` est désormais calculée par les processeurs des utilisateurs (en Edge Computing) plutôt que par un cluster centralisé.

---

## 13. Gestion des Auteurs et de l'Historique (Track Changes)

L'IHM d'ONLYOFFICE gère nativement l'affichage des curseurs colorés avec les prénoms des collaborateurs et le mode "Suivi des modifications". Il est crucial que notre pont transmette ces informations.

*   **Le CRDT (La source de vérité)** : Loro signe cryptographiquement chaque micro-delta (chaque lettre tapée) avec le `peer_id` (l'identifiant unique) du client Loro. L'historique est mathématiquement parfait.
*   **ONLYOFFICE (L'affichage)** : Au démarrage de l'éditeur, `sdkjs` reçoit une configuration d'initialisation contenant un dictionnaire des utilisateurs (ex: `{ "user_1": "Alice" }`).
*   **Le Rôle du Pont (Injector)** : 
    1. Lorsqu'un utilisateur distant (Bob) modifie le texte, notre routeur relaie son Delta Loro.
    2. Le moteur Loro d'Alice intègre la modification et identifie qu'elle provient du `peer_id` de Bob.
    3. Notre `LoroDocumentAdapter` reconstruit le faux `arrayChanges` pour l'écran d'Alice. Lors de cette reconstruction, **il injecte le `UserId` de Bob dans la structure JSON**.
    4. ONLYOFFICE ingère cet `arrayChanges`, voit qu'il appartient à Bob, et anime instantanément le curseur rouge de Bob à l'écran, tout en enregistrant la modification sous son nom dans l'historique des révisions.

C'est une mécanique purement *Plug & Play* : Loro assure la rigueur mathématique, et le pont traduit l'auteur pour satisfaire l'IHM officielle.

---

## 14. Sécurité, Authentification et SSO (OpenID Connect)

Dans un environnement Seafile branché sur un SSO (OpenID Connect / Keycloak), il est impératif de garantir que seuls les utilisateurs légitimes peuvent s'abonner au flux Loro d'un document.

Bien que le Routeur Rust soit "stupide" (il ne lit pas les documents), il doit agir comme un vigile intraitable :
1. **L'Authentification Seafile (SSO)** : L'utilisateur se connecte à Seafile via le SSO de l'entreprise. Seafile vérifie ses droits d'accès sur le fichier `.docx`.
2. **Le Jeton de Session (JWT)** : Si l'accès est autorisé, l'API de Seafile génère un jeton temporaire signé cryptographiquement (JWT) contenant le `FileId`, le `UserId` et les permissions (Lecture/Écriture). Seafile passe ce jeton au navigateur de l'utilisateur.
3. **Le Handshake WebSocket** : Le client ONLYOFFICE tente de se connecter au Routeur Rust pour rejoindre la salle : `wss://router.eurooffice.com/room_xyz?token=eyJhbG...`
4. **La Validation par le Routeur** : Le Routeur Rust lit le jeton. Il possède la clé publique de Seafile (ou un secret partagé) qui lui permet de vérifier la validité et l'expiration du jeton *sans avoir à interroger Seafile*. Si le jeton est valide, la connexion WebSocket est acceptée. Sinon, la connexion est coupée instantanément (`HTTP 401 Unauthorized`).

**Chiffrement de Bout-en-Bout / E2EE** :
Étant donné que le Routeur Rust ne fait que relayer des flux binaires Loro, cette architecture permet d'implémenter nativement le **Chiffrement de Bout-en-Bout**. 
Seafile peut transmettre une clé AES de déchiffrement directement aux navigateurs via le chargement de la page. Les clients chiffrent leurs Deltas Loro avant de les envoyer sur le WebSocket. Ainsi, le Routeur Rust (qui n'a pas la clé AES) relaie un trafic totalement opaque. Même en cas de piratage du Routeur, aucun document ne fuiterait.

### Le défi du Desktop Editor (Double-clic sur un fichier Seafile Drive)
Vous avez mis le doigt sur le point le plus technique : si l'utilisateur ouvre le document depuis son navigateur web, ONLYOFFICE connaît l'ID Seafile invariant du document (`file_id`). Mais s'il double-clique sur le fichier `.docx` dans son explorateur Windows/Mac, l'application s'ouvre "à froid". Elle ne voit qu'un chemin local (ex: `C:\Users\Bob\Seafile\projet\doc.docx`).
**Comment trouver l'identifiant Seafile (Room ID) et authentifier le flux ?**
Bien que la fonction native "Connecter au Cloud" d'ONLYOFFICE permette de s'authentifier, elle ne résout pas la traduction du chemin local en `file_id` Seafile lors d'un double-clic. Nous devons donc utiliser une approche hybride :
1. **Dialogue avec le démon local (SeaDrive API)** : Le client de synchronisation Seafile Drive tourne en tâche de fond et possède une API locale (sur `127.0.0.1` ou via un *Named Pipe*). Au démarrage, notre pont (injecté dans le Desktop Editor) envoie le chemin du fichier (`C:\...\doc.docx`) à cette API locale. 
2. **Récupération des métadonnées** : Le démon SeaDrive répond à notre pont en lui fournissant le `file_id` invariant du document sur le serveur, ainsi qu'un jeton JWT valide (issu de la session SSO de SeaDrive).
3. **Ouverture du WebSocket** : Fort de ce `file_id` (qui devient le Room ID) et de ce jeton JWT, le Desktop Editor peut ouvrir sa connexion `wss://router.eurooffice.com/room/{file_id}?token={jwt}` de manière totalement transparente. Le routeur Rust connectera ainsi Bob (Desktop) et Alice (Web) dans la même salle de collaboration.

### Le scénario du "Custom URI Scheme" (Ouvrir dans l'app de bureau depuis le Web)
Un troisième cas d'usage très courant existe : Dave n'a pas SeaDrive installé. Il est sur l'interface web de Seafile et clique sur le bouton **"Ouvrir sur l'application de bureau"**.
Dans ce cas, c'est beaucoup plus simple que le double-clic de Bob !
1. Seafile génère un lien profond (Deep Link) appelé **Custom URI Scheme** (ex: `onlyoffice://api/open?url=https://seafile.../doc.docx&file_id=XYZ-123&token=JWT`).
2. Le navigateur web de Dave passe ce lien au système d'exploitation, qui lance *ONLYOFFICE Desktop Editor*.
3. ONLYOFFICE Desktop lit l'URL. Comme l'URL contient *déjà* le `file_id` et le `token` JWT générés par Seafile Web, le Desktop Editor n'a **pas besoin** de SeaDrive. Il possède toutes les clés en main pour se connecter directement au Routeur Rust, exactement comme s'il était un client Web !

```mermaid
sequenceDiagram
    box Réseau Local (Clients)
    participant Alice as Alice (Navigateur Web)
    participant Dave as Dave (Desktop via Web UI)
    participant Bob as Bob (Desktop via Double-clic OS)
    participant SeaDrive as Démon SeaDrive local
    end
    box Internet
    participant Seafile as Serveur Seafile (SSO)
    participant Router as Routeur Rust
    end

    %% Scénario Alice (Web)
    Alice->>Seafile: 1. Ouvre doc.docx sur le web
    Seafile-->>Alice: file_id + JWT
    Alice->>Router: wss://.../room/XYZ-123

    %% Scénario Dave (Desktop depuis le Web)
    Dave->>Seafile: 2. Clique "Ouvrir dans l'app de bureau"
    Seafile-->>Dave: Lien: onlyoffice://...&file_id=XYZ&token=JWT
    Dave->>Router: wss://.../room/XYZ-123 (Sans SeaDrive !)

    %% Scénario Bob (Desktop depuis fichier local)
    Bob->>Bob: 3. Double-clique sur C:\...\doc.docx
    Bob->>SeaDrive: Demande API Locale: Quel est cet ID ?
    SeaDrive-->>Bob: Retourne file_id + JWT (SSO local)
    Bob->>Router: wss://.../room/XYZ-123
    
    Note over Alice, Bob: Les 3 utilisateurs collaborent dans le même CRDT Loro !
```

---

## 15. Commentaires, Mentions (@) et Notifications Externes

La gestion des commentaires et de l'intelligence sociale (mentions avec "@") est une fonctionnalité clé d'ONLYOFFICE. Heureusement, le moteur natif prévoit explicitement des points d'accroche (hooks) pour s'interfacer avec un système externe comme Seafile.

### 1. La Synchronisation P2P du Commentaire (Loro)
Dans le modèle de données de `sdkjs`, un commentaire est simplement un objet (généralement rattaché à une zone de texte via un identifiant).
Lorsque Dave ajoute un commentaire, ONLYOFFICE génère une mutation `arrayChanges` qui ordonne l'ajout de cet objet "Commentaire". 
Notre pont interceptant *toutes* les mutations de manière générique, **le commentaire sera naturellement synchronisé vers Loro** et relayé à tous les pairs, exactement comme si c'était une mise en gras. Aucune logique spécifique n'est requise dans Loro pour les commentaires, ils bénéficient du même traitement miroir que le texte.

### 2. Le Hook d'Autocomplétion (Les Mentions)
Pour qu'une liste déroulante s'affiche lorsque l'utilisateur tape `@` dans la boîte de commentaire, ONLYOFFICE propose un événement d'interface publique : `onRequestUsers`.
*   **Fonctionnement** : Dans le code d'initialisation de l'éditeur (souvent côté iframe/API), on déclare le hook `config.events.onRequestUsers`.
*   **Action** : Dès que l'utilisateur tape `@`, ce hook est appelé. Notre pont exécutera alors un appel API vers Seafile pour récupérer la liste des collaborateurs (avec leur ID et leur nom).
*   **Affichage** : ONLYOFFICE affiche nativement la liste. L'utilisateur en sélectionne un, et l'éditeur insère une balise mention officielle dans le commentaire.

### 3. Le Hook de Notification Externe (Envoi d'email / Hub Central du SI)
Une fois le commentaire avec mention validé (bouton "Répondre" ou "Ajouter"), il faut alerter l'utilisateur mentionné.
*   **L'événement** : ONLYOFFICE déclenche le hook natif `config.events.onRequestSendNotify`.
*   **La Charge Utile (Payload)** : L'événement nous transmet un objet contenant :
    - Le `message` (le texte du commentaire).
    - La liste `actionLink` (pour créer un lien direct vers le fichier).
    - La liste des `userIds` des personnes mentionnées.
*   **L'Action du Pont (Agnostique)** : Notre pont intercepte cet événement et effectue immédiatement une requête HTTP POST (un Webhook). Ce Webhook n'est pas limité à Seafile ! L'architecture étant agnostique, ce payload peut être envoyé :
    - Soit à Seafile pour déclencher sa cloche interne.
    - Soit (ou en plus) à un **Hub Central de Notifications du Système d'Information (SI)** (ex: bus de messages RabbitMQ, composant central d'entreprise, webhook Microsoft Teams/Slack, etc.).
    Cela permet à l'entreprise de centraliser 100% des notifications de ses applications.

**Résumé** : Le CRDT Loro se charge de propager l'existence visuelle et textuelle du commentaire à tout le monde en temps réel, tandis que l'IHM ONLYOFFICE s'interface très facilement avec n'importe quel Hub de notifications externe de votre SI grâce à ses hooks `onRequestUsers` et `onRequestSendNotify`.

---

## 16. Impact sur le Cœur d'ONLYOFFICE (Maintenabilité)

Face à l'ajout de toutes ces fonctionnalités "haut niveau" (Sauvegarde Client-Side, Noms des auteurs, Authentification SSO Desktop, Mentions, et Webhooks de notification décrites dans les chapitres 12 à 15), la question de la maintenabilité et de l'intégrité du logiciel se pose : **Allons-nous dénaturer ONLYOFFICE ?**

La réponse est **NON, absolument pas.** 
La grande force de cette architecture est qu'elle nécessite **zéro modification** dans le code source profond d'ONLYOFFICE (`sdkjs`, le code WASM, ou le moteur OT). 

Voici pourquoi couche par couche :
*   **Chapitre 12 (Sauvegarde)** : L'export du fichier exploite la méthode publique officielle de `sdkjs` (ex: `downloadAs`). Notre pont ne fait qu'appeler cette fonction documentée.
*   **Chapitre 13 (Historique des Auteurs)** : L'attribution des couleurs et des noms se fait via l'objet de configuration standard (`config.document.info`) passé à l'initialisation de l'iframe. C'est la norme officielle d'ONLYOFFICE.
*   **Chapitre 14 (Sécurité SSO/Réseau)** : L'éditeur ONLYOFFICE ignore totalement comment fonctionne le réseau. La vérification du JWT et la création du WebSocket se font exclusivement dans **notre script de Pont Javascript (LoroDocumentAdapter)**, avant même que les données n'entrent dans ONLYOFFICE. L'éditeur reste parfaitement étanche.
*   **Chapitre 15 (Commentaires & Notifications)** : Les événements `onRequestUsers` et `onRequestSendNotify` ne sont pas des piratages. Ce sont des **points d'accroche (hooks) officiels et documentés** par Ascensio System (l'éditeur d'ONLYOFFICE), conçus précisément pour que des développeurs puissent s'y greffer sans modifier le code source.

**En conclusion :**
L'outil n'est jamais dénaturé. Nous utilisons l'éditeur ONLYOFFICE exactement comme il a été conçu pour être utilisé : comme un composant d'interface (Vue) qui est piloté de l'extérieur par des configurations et des APIs publiques. Cela garantit que lors des futures mises à jour d'ONLYOFFICE, nos intégrations SSO et sociales continueront de fonctionner sans nécessiter de maintenance lourde.

---

## 17. Compatibilité Multi-Formats (Word, Excel, PowerPoint)

Il est crucial de souligner que toute cette machinerie (le pont Loro, l'intercepteur `arrayChanges`, la séparation RAM/Réseau avec `FromJSON`) n'est **pas du tout limitée à Word (`.docx`)**.

L'architecture interne d'ONLYOFFICE (`sdkjs`) a été pensée de manière unifiée pour ses trois éditeurs :
*   `sdkjs/word/` (Documents)
*   `sdkjs/cell/` (Tableurs Excel)
*   `sdkjs/slide/` (Présentations PowerPoint)

**Pourquoi notre architecture fonctionne-t-elle pour les trois ?**
1. **L'Agnosticisme du Registre Plat** : Notre adaptateur Loro se fiche de savoir s'il synchronise la largeur d'une colonne Excel ou la couleur d'un titre Word. Il voit simplement des clés/valeurs rattachées à un `InternalId`. Les trois éditeurs utilisent exactement le même système universel d'`InternalId`.
2. **Le Format Universel arrayChanges** : Les ingénieurs d'ONLYOFFICE ont implémenté le système `arrayChanges` (le moteur de collaboration OT) comme une brique noyau commune (Core) aux trois logiciels. Que Bob ajoute une diapositive PowerPoint ou tape du texte dans Excel, la structure du flux réseau capturé par notre Injecteur est la même.
3. **Le Cold Start Universel** : Les trois éditeurs possèdent chacun leur propre fichier `fromToJSON.js` (`cell/fromToJSON.js`, `slide/fromToJSON.js`). La mécanique de désérialisation rapide depuis le cache Loro s'applique donc de manière rigoureusement identique pour Excel et PowerPoint.

Notre pont CRDT est donc par essence **agnostique au format de fichier**. Il synchronise des objets DOM virtuels, faisant de cette architecture une solution universelle pour toute la suite bureautique.

---

## 18. Synchronisation des Curseurs (Awareness Channel)

Si le moteur Loro CRDT excelle dans la sauvegarde de l'historique permanent du document (le texte tapé, le style modifié), il n'est **pas du tout adapté** pour synchroniser les mouvements frénétiques des curseurs de souris ou les sélections de texte temporaires. Stocker chaque déplacement de curseur dans l'historique immuable du CRDT ferait exploser la taille du fichier et l'usage de la RAM.

Pour gérer cette intelligence collaborative, nous utilisons un **Canal d'Awareness (Awareness Channel)**.

### Le Principe
L'Awareness est un flux de données éphémères (qui ne sont pas écrites sur le disque).
1. **Interception Éphémère** : Lorsque Bob sélectionne un paragraphe, ONLYOFFICE déclenche un événement interne de changement de sélection. Notre pont capte cet événement.
2. **Le Payload Léger** : Le pont génère un petit objet JSON éphémère contenant :
   * Son `peer_id` (Bob)
   * Sa couleur assignée (Rouge)
   * La position de son curseur (ex: *Paragraphe ID 123, offset 42*)
3. **Le Réseau (Broadcast Agnostique)** : Ce flux JSON éphémère est multiplexé (envoyé comme un type de message différent) sur **la même connexion réseau que le CRDT**.
   * *Sur Terre (Internet)* : Il passe par le Routeur Rust central.
   * *Dans l'Avion (P2P mDNS)* : Il passe par la connexion directe (WebSocket local ou WebRTC) établie entre les pairs.
   * Une limite d'envoi (Throttle) est fixée à 50ms pour ne pas saturer la bande passante.
4. **L'Affichage Distant et la Transition** : Le client d'Alice reçoit ce JSON. Notre pont le traduit et demande à l'API publique d'ONLYOFFICE (`CCollaborativeCursor`) de dessiner le curseur rouge. Étant donné que ces données sont éphémères (pas d'historique), le passage du mode "Avion" (P2P) au mode "Terre" (Routeur) se fait instantanément et sans aucun besoin de réconciliation mathématique. Les curseurs s'affichent simplement à leur dernière position connue.
### Pourquoi c'est élégant
Si Bob se déconnecte subitement, le Routeur Rust détecte la perte du WebSocket et envoie un signal `UserLeft(Bob)` à tous les autres clients. Le pont d'Alice ordonne alors au moteur ONLYOFFICE d'effacer le curseur rouge de Bob.
Tout ceci se passe **en dehors du CRDT**. Le document Word n'est jamais altéré par les mouvements de souris, garantissant une intégrité parfaite du `.docx` final tout en offrant une expérience "Temps Réel" ultra-fluide digne de Google Docs.

---

## 19. Limites Fonctionnelles et Compromis (Trade-offs)

L'architecture décentralisée (CRDT + P2P) représente un changement de paradigme profond par rapport au Document Server centralisé de base d'ONLYOFFICE (ou à Office 365). Troquer "l'intelligence centralisée" pour "l'intelligence distribuée" (qui permet le vrai mode hors-ligne, la scalabilité infinie et la confidentialité absolue E2EE) entraîne mécaniquement l'abandon ou l'adaptation de certaines fonctionnalités natives :

### 19.1 La perte du "Mode Strict" (Verrouillage explicite)
ONLYOFFICE propose historiquement un mode **Strict** (un paragraphe est "verrouillé" par un utilisateur et invisible pour les autres tant qu'il ne sauvegarde pas). 
Dans un système P2P offline-first, le verrouillage cryptographique est impossible à garantir de manière absolue (impossible de vérifier l'état d'un verrou sur serveur si l'on est hors-ligne dans un avion). 
**Solution (Le Soft-Lock via Awareness)** : Nous pouvons recréer une illusion parfaite du mode Strict pour l'UX. Lorsqu'un utilisateur clique dans un paragraphe, le pont diffuse un message "Verrouillé" via le canal éphémère d'Awareness. Les autres clients reçoivent ce message et passent localement le paragraphe en "Lecture Seule" dans leur UI ONLYOFFICE. Ce verrouillage est "doux" (soft), mais il remplit 99% du besoin métier consistant à empêcher les collisions visuelles de frappe.

### 19.2 Sécurité granulaire (Confiance Client)
Dans des solutions comme Office 365, le serveur rejette activement les modifications sur des cellules protégées. 
Notre Routeur Rust étant aveugle (Chiffrement E2EE), il ne lit pas le document. Si un utilisateur "hacke" son client ONLYOFFICE local pour modifier une plage Excel interdite, Loro l'acceptera mathématiquement. 
**Solution (Enforcement côté Client & Audit)** : Nous déléguons la sécurité à l'interface client. Le jeton JWT de Seafile transmet les permissions (ACL). C'est le code de notre pont JavaScript qui verrouillera localement les cellules interdites dans l'UI d'ONLYOFFICE. Pour les environnements de très haute sécurité, l'historique immuable du CRDT (qui signe cryptographiquement chaque frappe) permet d'auditer le document *a posteriori* et d'annuler (rollback) mathématiquement toute modification frauduleuse.

### 19.3 Historique des Versions (UI Native)
L'UI native de l'historique d'ONLYOFFICE a l'habitude de dialoguer avec le Document Server pour récupérer les révisions (V1, V2). 
Notre architecture délègue le stockage des révisions à **Seafile**. Par défaut, le bouton "Historique" de l'éditeur semblera cassé car le Document Server a disparu.
**Solution (L'interception de l'API Historique)** : ONLYOFFICE expose publiquement les hooks `config.events.onRequestHistory` et `config.events.onRequestHistoryData`. Notre pont JavaScript interceptera le clic de l'utilisateur sur le bouton "Historique", exécutera une requête vers l'API native de Seafile pour récupérer les anciennes versions du fichier, et les réinjectera dans l'UI d'ONLYOFFICE. L'expérience utilisateur reste ainsi parfaitement fluide et intégrée.

### 19.4 Génération de PDF et Publipostage Serveur
Beaucoup d'entreprises utilisent l'API du Document Server pour générer des PDF sans ouvrir le document. Notre routeur relais ne possède pas le moteur C++ de rendu. 
**Solution (Le Bot Headless Node.js)** : Puisque le client web est capable de générer le `.docx` et le `.pdf` localement en WASM (Edge Computing), nous pouvons déployer un microservice "Bot" (un script Node.js exécutant `sdkjs` sans interface graphique). Ce Bot se connecte discrètement au Routeur Rust comme un utilisateur fantôme. Il maintient l'état CRDT en permanence dans sa RAM. Lorsque le SI a besoin d'un PDF, il appelle l'API de ce Bot, qui génère le fichier instantanément sans surcharger de lourds serveurs C++ traditionnels.

### 19.5 Le Chat Intégré (Désactivation au profit de Matrix)
ONLYOFFICE possède un widget de chat intégré. Nous ne synchronisons pas ce chat dans le CRDT. 
**Solution** : Conformément à la volonté de fédérer les communications via un client **Matrix** externe, nous pouvons désactiver ce widget pour éviter qu'il n'apparaisse "cassé". ONLYOFFICE prévoit exactement cela dans sa configuration d'initialisation. Il suffit de passer le paramètre `customization.chat = false` lors de l'instanciation de l'iframe pour masquer proprement toute trace de ce widget graphique, laissant la place nette à l'outil de communication du Système d'Information.

---

## 20. Opportunités Futures (v2) : Le Branching (Git pour le texte)

Afin de livrer un MVP robuste, notre architecture se concentre sur l'usage "Temps Réel" du CRDT (à la Google Docs). Cependant, le moteur Loro offre des capacités de gestion d'historique non-linéaire extrêmement puissantes que nous pourrons exploiter dans une version ultérieure :

**Le Branching & Merging (Workflow Asynchrone)** :
À l'image de Git pour les développeurs, Loro supporte la création de "Branches" de document.
*   **Le Cas d'usage** : Un utilisateur souhaite proposer une réécriture complète d'un chapitre d'un contrat sans perturber le document principal sur lequel travaillent ses collègues.
*   **La Mécanique** : Le client ONLYOFFICE crée un *Fork* local en mémoire (`doc.fork()`). L'utilisateur travaille isolé pendant plusieurs jours. Lorsqu'il a terminé, il déclenche un `doc.merge(branch)`.
*   **La Magie CRDT** : Contrairement au mode "Suivi des modifications" classique, Loro fusionnera mathématiquement le paragraphe réécrit avec les autres corrections orthographiques que ses collègues auraient pu faire sur le document principal (*Main*) entre-temps, avec une résolution de conflits sémantique et déterministe.
