# Feuille de route : Intégration Loro CRDT × ONLYOFFICE/EuroOffice

## Vue d'ensemble

```mermaid
gantt
    title Feuille de route Loro × ONLYOFFICE (~8-10 semaines)
    dateFormat  YYYY-MM-DD
    axisFormat  %d/%m

    section Phase 0 — Préparation
    Environnement de dev & CI               :p0a, 2026-09-01, 3d
    Étude de licence AGPLv3/MIT             :p0b, 2026-09-01, 2d

    section Phase 1 — Analyse sdkjs
    Cartographie du modèle objet            :p1a, after p0a, 3d
    Isolation du moteur standalone          :p1b, after p1a, 2d
    Identification des hooks de mutation    :p1c, after p1a, 2d

    section Phase 2 — Binding Loro WASM
    Modélisation OOXML → conteneurs Loro    :p2a, after p1c, 3d
    Pont TypeScript ↔ Rust/WASM             :p2b, after p2a, 3d

    section Phase 3 — Interception des mutations
    Hook des frappes texte (CRun/CParagraph) :p3a, after p2b, 4d
    Hook du formatage (styles, spans)       :p3b, after p3a, 3d
    Hook des structures (tableaux, images)  :p3c, after p3b, 4d

    section Phase 4 — Serveur relais
    Relais WebSocket Rust (Axum/Tokio)      :p4a, after p2b, 3d
    Persistance append-only log             :p4b, after p4a, 2d
    Snapshot client → Seafile               :p4c, after p4b, 2d

    section Phase 5 — Stabilisation
    Anti-écho & flags de mutation           :p5a, after p3c, 3d
    Synchronisation des curseurs            :p5b, after p5a, 3d
    Fuzz testing multi-utilisateurs         :p5c, after p5b, 4d
    Panneau de révision (Track Changes)     :p5d, after p5a, 3d

    section Phase 6 — Démo & POC
    Intégration Seafile / stockage          :p6a, after p5c, 2d
    Documentation & démo live               :p6b, after p6a, 2d

    section Phase 7 — Desktop Editors
    Fork & build + injection Loro           :p7a, after p6b, 3d
    Branchement UI offline existante        :p7b, after p7a, 2d
    Auto-découverte mDNS (avion)            :p7c, after p7b, 3d
```

---

## Phase 0 — Préparation de l'environnement (3 jours)

### Objectif
Mettre en place l'outillage, le dépôt et les bases juridiques avant d'écrire la première ligne de code.

### Tâches

| # | Tâche | Détail | Livrable |
|---|---|---|---|
| 0.1 | **Fork du dépôt sdkjs** | Cloner `ONLYOFFICE/sdkjs` (branche stable v8.x). Créer un dépôt privé `eurooffice-loro`. | Repo Git configuré |
| 0.2 | **Workspace de dev reproductible** | Dockerfile de développement : Node.js 20 + Rust toolchain (rustup, wasm-pack, wasm-bindgen-cli) + Vite pour le hot-reload JS. | `docker-compose.dev.yml` fonctionnel |
| 0.3 | **Build standalone de sdkjs** | Compiler sdkjs en mode Desktop/standalone (sans document-server). Vérifier qu'un `.docx` s'ouvre et se rend dans un `<canvas>` sans backend Node.js. | Page HTML qui ouvre un .docx localement |
| 0.4 | **Audit de licence** | Confirmer la compatibilité AGPLv3 (ONLYOFFICE) + MIT/Apache-2.0 (Loro). Le résultat distribué sera AGPLv3. Documenter les obligations (publication du code source modifié). | Note juridique dans le README |
| 0.5 | **CI/CD minimal** | GitHub Actions : `cargo test` (Rust), `npm test` (JS), build WASM automatique. | Pipeline vert |

### Risques
- La compilation standalone de sdkjs peut nécessiter de stubber des APIs du document-server → prévoir 1 jour de marge.

---

## Phase 1 — Analyse et cartographie de sdkjs (5 jours)

### Objectif
Comprendre précisément **où** et **comment** le DOM interne est muté, pour savoir quoi intercepter.

### 1.1 Cartographie du modèle objet (3 jours)

Utiliser un agent LLM pour analyser les fichiers clés et produire un document de référence :

```
sdkjs/word/
├── document/CDocument.js        → Racine du document
├── document/CParagraph.js       → Paragraphes (4000+ lignes)
├── document/CRun.js             → Segments de texte homogènes
├── document/CTable.js           → Tableaux
├── document/CSection.js         → Sections (marges, orientation)
├── drawing/CShape.js            → Formes vectorielles
└── api/asc_docs_api.js          → API publique exposée au web-apps
```

**Livrable** : Document Markdown `sdkjs-dom-map.md` avec :
- Arbre d'héritage des classes principales
- Liste exhaustive des méthodes de mutation (`AddText`, `SetBold`, `SplitRun`, `MergeTableCells`...)
- Diagramme du pipeline mutation → dirty flags → recalculate → draw

### 1.2 Isolation du moteur réseau (2 jours)

*Note architecturale : L'idée initiale de créer un standalone HTML chargeant des fichiers .docx a été abandonnée car sdkjs ne parse pas nativement le .docx (c'est le rôle de `x2t`/`wasm` dans les clients Web et Desktop officiels). Nous conservons donc les clients officiels intacts.*

| Tâche | Détail |
|---|---|
| Arracher le tuyau réseau (`DocsCoApi`) | Créer un script d'injection (`Injector.ts`) qui stubbe `AscCommon.CDocsCoApi` pour bloquer la communication WebSocket vers le Document Server. |
| Intercepter `saveChanges` | Dévier les objets de mutation OT locaux (`arrayChanges`) vers notre futur traducteur CRDT au lieu du réseau officiel. |
| Valider l'isolement | Démontrer que le client fonctionne sans backend, et que les frappes locales sont interceptées par le script d'injection. |

### 1.3 Identification des hooks de mutation (2 jours)

Lister les **9 catégories de mutations** à intercepter :

| Catégorie | Méthodes clés dans sdkjs | Conteneur Loro cible |
|---|---|---|
| Insertion de texte | `CRun.AddText()`, `CParagraph.Internal_Content_Add()` | `LoroText.insert()` |
| Suppression de texte | `CRun.RemoveText()`, `CParagraph.Internal_Content_Remove()` | `LoroText.delete()` |
| Formatage inline | `CRun.SetBold()`, `.SetItalic()`, `.SetFontSize()` | `LoroText.mark()` |
| Style de paragraphe | `CParagraph.SetStyle()`, `.SetAlignment()` | `LoroMap` (propriétés) |
| Opérations sur tableaux | `CTable.AddRow()`, `.MergeCells()`, `.RemoveColumn()` | `LoroList` + `LoroMap` |
| Images et formes | `CShape.setPosition()`, `CDrawing.Set_WrappingType()` | `LoroMap` (propriétés d'ancrage) |
| Sections | `CSection.SetPageSize()`, `.SetMargins()` | `LoroMap` |
| Undo/Redo | `CHistory.Add_Transaction()` | `LoroDoc.commit()` / checkout |
| Curseur/Sélection | `CDocumentContent.SetSelectionState()` | Awareness channel (hors CRDT) |

**Livrable** : Fichier `hooks-inventory.md` — la spécification technique du binding.

---

## Phase 2 — Binding Loro WASM ↔ TypeScript (6 jours)

### Objectif
Créer le **modèle de données Loro** qui reflète un document OOXML, et le pont TypeScript pour l'alimenter.

### 2.1 Modélisation OOXML → conteneurs Loro (3 jours)

Concevoir le schéma de l'arbre Loro qui représente un document Word :

```typescript
// Structure cible du LoroDoc pour un document texte
const doc = new LoroDoc();

// Métadonnées du document
const meta = doc.getMap("meta");
// meta.set("title", "Mon rapport");
// meta.set("author", "Pierre");

// Corps du document = liste ordonnée de blocs
const body = doc.getList("body");

// Chaque bloc = une Map décrivant un paragraphe, tableau, ou image
// Exemple paragraphe :
// {
//   type: "paragraph",
//   style: "Heading1",
//   alignment: "center",
//   content: LoroText (avec marks pour le formatage inline)
// }

// Exemple tableau :
// {
//   type: "table",
//   rows: LoroList<LoroList<{ content: LoroText, colspan, rowspan }>>
// }

// Sections (sauts de page, marges)
const sections = doc.getList("sections");
```

> [!IMPORTANT]
> **Décision architecturale critique** : Granularité du CRDT.
> - Trop fin (1 conteneur par caractère) → explosion mémoire
> - Trop gros (1 conteneur par page) → conflits fréquents
> - **Choix recommandé** : 1 `LoroText` par paragraphe + 1 `LoroMap` par bloc pour les propriétés

### 2.2 Pont TypeScript ↔ Rust/WASM (3 jours)

| Tâche | Détail |
|---|---|
| Intégrer `loro-crdt` via npm | `npm install loro-crdt` (package officiel compilé en WASM) |
| Créer `LoroDocumentAdapter.ts` | Classe centrale qui encapsule le `LoroDoc` et expose des méthodes typées : `insertText(paraIndex, offset, text)`, `deleteText(...)`, `setMark(...)`, `addParagraph(...)` |
| Créer `LoroSyncManager.ts` | Gère la connexion WebSocket, l'export/import des deltas binaires, et le buffering des opérations offline |
| Créer `LoroAwareness.ts` | Canal léger séparé pour les curseurs et sélections des autres utilisateurs (pas stocké dans le CRDT principal) |
| Tests unitaires | 30+ tests : insertion, suppression, formatage concurrent, serialisation/désérialisation d'un LoroDoc complet |

**Livrable** : Package `@eurooffice/loro-bridge` testable indépendamment de sdkjs.

---

## Phase 3 — Interception des mutations sdkjs (11 jours)

### Objectif
Brancher le pont Loro sur le pipeline de mutations de sdkjs. C'est **la phase la plus complexe**.

### 3.1 L'Approche Industrielle : Le Registre Plat (Flat Node Registry) (3 jours)

Au lieu de modéliser manuellement un arbre DOM complexe, nous créons un miroir générique du DOM d'ONLYOFFICE basé sur les identifiants uniques (`InternalId`) :

```typescript
// Structure cible du Registre Plat
const doc = new LoroDoc();
const nodes = doc.getMap("nodes"); // Le registre universel

// Création générique d'un nœud (applicable à Word, Excel, PowerPoint)
const paraNode = new LoroMap();
paraNode.set("type", "Paragraph");
paraNode.setContainer("props", new LoroMap()); // Pour stocker Bold, Margins, etc.
paraNode.setContainer("children", new LoroList()); // Pour stocker les InternalId des enfants
nodes.setContainer("para_123", paraNode);
```

### 3.2 Interception du moteur OT (arrayChanges) (4 jours)

Plutôt que d'intercepter individuellement `SetBold()`, `AddText()`, etc., nous allons écouter le flux de sortie du moteur OT interne d'ONLYOFFICE (`arrayChanges`).

| Avantage | Détail |
|---|---|
| **Atomicité garantie** | L'OT natif calcule déjà le delta exact (ex: *seule la bordure a changé*). |
| **Future-proof** | Si ONLYOFFICE ajoute une nouvelle propriété visuelle, le pont la synchronisera automatiquement sans modification du code. |
| **Performance** | Pas besoin d'algorithme de "Diff" coûteux en RAM côté Loro. |

### 3.3 Le pont "Passe-Plat" (ArrayChangesMapper) (4 jours)

Il s'agit de construire la classe de traduction bidirectionnelle :
1. **Aller (Local → Réseau)** : Intercepter le tableau `arrayChanges` généré par `sdkjs`, lire l'ID de l'objet affecté, et reporter la clé/valeur bêtement dans le `LoroMap` correspondant. Loro génère le delta binaire.
2. **Retour (Réseau → Local)** : Quand le Loro distant notifie une mise à jour (`subscribe()`), le Mapper reconstruit un faux objet `arrayChanges` et l'injecte dans le moteur de rendu d'ONLYOFFICE.

> [!WARNING]
> **Le défi majeur** : Isoler complètement la logique de traduction des "Magic Codes" de l'OT d'ONLYOFFICE (ex: `Type: 14`) dans ce fichier de Mapping unique, pour protéger le projet des changements d'API futurs.

### 3.4 Sécurisation : Le Mutation Guard (inclus)

```typescript
// Le verrou anti-écho (pour éviter les boucles infinies de deltas)
let isApplyingRemoteUpdate = false;

loroDoc.subscribe((event) => {
  if (event.by === "import") {
    isApplyingRemoteUpdate = true;
    
    const fakeArrayChanges = mapper.loroEventToArrayChanges(event);
    sdkDocument.ApplyChanges(fakeArrayChanges); // Injection native
    
    // Le hook saveChanges d'ONLYOFFICE devra bloquer l'émission réseau si isApplyingRemoteUpdate === true
    
    isApplyingRemoteUpdate = false;
  }
});
```

---

## Phase 4 — Serveur relais et persistance (7 jours)

### 4.1 Relais WebSocket Rust (3 jours)

Architecture minimaliste déjà détaillée dans la synthèse :

```
loro-relay-server/
├── Cargo.toml
├── Dockerfile          # Multi-stage build, image finale FROM scratch (~15 Mo)
├── docker-compose.yml
└── src/
    ├── main.rs         # Axum router + upgrade WebSocket
    ├── relay.rs        # DashMap<DocId, broadcast::Sender<Bytes>>
    └── auth.rs         # Vérification JWT/Token Seafile (optionnel)
```

| Fonctionnalité | Détail |
|---|---|
| Routing par document | `GET /ws/:doc_id` → upgrade WebSocket |
| Broadcast zéro-copie | `tokio::sync::broadcast` avec `Bytes` (pas de sérialisation) |
| Auto-nettoyage | Suppression de la room quand `receiver_count() == 0` |
| Authentification | Vérification d'un token JWT ou Seafile en amont de l'upgrade WebSocket |
| Métriques | Endpoint `/metrics` (Prometheus) : nombre de rooms actives, connexions, octets relayés |

### 4.2 Persistance append-only log (2 jours)

```rust
// Pour chaque delta reçu, append dans le fichier journal
async fn append_delta(doc_id: &str, delta: &[u8]) -> io::Result<()> {
    let path = format!("./data/logs/{}.binlog", doc_id);
    let mut file = OpenOptions::new().create(true).append(true).open(&path).await?;
    // Format : [u32 length][bytes delta]
    file.write_all(&(delta.len() as u32).to_le_bytes()).await?;
    file.write_all(delta).await?;
    file.flush().await?;
    Ok(())
}
```

| Tâche | Détail |
|---|---|
| Format du journal | Séquentiel TLV (Type-Length-Value) : `[4 bytes longueur][N bytes delta Loro]` |
| Rotation des logs | Après réception d'un snapshot consolidé du client → troncature du `.binlog` |
| Reconstruction au démarrage | `GET /api/docs/:doc_id/recovery` → renvoie le dernier snapshot Seafile + le binlog restant |

### 4.3 Snapshot client → Seafile (2 jours)

```typescript
// Déclenché à la fermeture de l'onglet ou périodiquement (toutes les 5 min)
async function pushSnapshotToSeafile(doc: LoroDoc, docId: string) {
  const snapshot = doc.export({ mode: "snapshot" }); // Binaire compact

  await fetch(`/api/docs/${docId}/snapshot`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: snapshot,
  });

  // Signale au serveur relais qu'il peut tronquer le binlog
  await fetch(`/api/docs/${docId}/flushed`, { method: "POST" });
}

// Hook sur beforeunload pour sauvegarder avant fermeture
window.addEventListener("beforeunload", () => {
  navigator.sendBeacon(`/api/docs/${docId}/snapshot`, snapshotBytes);
});
```

**Côté serveur** : le endpoint `/api/docs/:doc_id/snapshot` pousse le binaire vers l'API Seafile (ou S3/MinIO) et tronque le fichier `.binlog`.

---

## Phase 5 — Stabilisation et UX (10-13 jours)

### 5.1 Anti-écho et flags de mutation (3 jours)

Le problème central : quand un delta distant est appliqué sur sdkjs, sdkjs émet naturellement un événement de modification qui serait capturé par le hook et renvoyé à Loro en boucle infinie.

```typescript
class MutationGuard {
  private _depth = 0;

  /** Encadre l'application d'une modification distante */
  applyRemote(fn: () => void) {
    this._depth++;
    try {
      fn();
    } finally {
      this._depth--;
    }
  }

  /** Vérifie si on est dans un contexte local (à capturer) ou distant (à ignorer) */
  isLocal(): boolean {
    return this._depth === 0;
  }
}
```

| Cas limite | Solution |
|---|---|
| Mutation distante déclenche un split de CRun | Le flag `_depth > 0` empêche la réémission |
| Undo local qui annule une modification distante | L'undo passe par `CHistory` → capturé comme mutation locale → propagé normalement |
| Recalculate déclenché pendant un batch de deltas | Accumuler les deltas, appliquer en batch, puis un seul `Recalculate()` |

### 5.2 Synchronisation des curseurs (3 jours)

Les positions de curseur ne sont **pas** stockées dans le CRDT principal (elles sont éphémères).

| Composant | Implémentation |
|---|---|
| Canal Awareness | WebSocket secondaire ou sous-canal dédié sur le même socket |
| Données transmises | `{ peerId, name, color, cursorParaIndex, cursorOffset, selectionRange }` |
| Fréquence | Throttled à 50ms max (éviter le flood réseau) |
| Affichage sdkjs | Injecter des `CCollaborativeCursor` dans le Canvas (trait vertical coloré + étiquette nom) |
| Transformation des positions | Quand un delta distant déplace du texte **avant** la position du curseur distant → recalculer l'offset via les métadonnées Loro |

### 5.3 Fuzz testing multi-utilisateurs (4 jours)

Cadre de test automatisé simulant N clients concurrents :

```typescript
// Test de convergence : 5 clients tapent simultanément pendant 10 secondes
async function fuzzTest(numClients: number, durationMs: number) {
  const docs = Array.from({ length: numClients }, () => new LoroDoc());

  // Chaque client effectue des opérations aléatoires
  for (let t = 0; t < durationMs; t += 10) {
    for (const doc of docs) {
      const op = randomOperation(); // insert, delete, mark, moveParagraph
      applyOperation(doc, op);
    }
    // Synchroniser tous les pairs entre eux
    fullSync(docs);
  }

  // ASSERTION : tous les documents sont identiques
  const states = docs.map(d => d.getText("content").toString());
  assert(new Set(states).size === 1, "Désynchronisation détectée !");
}
```

| Scénario de fuzz | Ce qu'on vérifie |
|---|---|
| 5 clients tapent dans le même paragraphe | Convergence du texte (pas d'entremêlement) |
| Insert + delete concurrents au même offset | Cohérence de l'arbre Loro et du DOM sdkjs |
| Formatage concurrent (gras + italique) | Les marks ne se corrompent pas mutuellement |
| Ajout/suppression de lignes de tableau | La structure tabulaire reste valide |
| Undo simultané sur 2 clients | L'état converge sans crash |
| Déconnexion brutale + reconnexion | Le binlog permet la reconstruction exacte |

### 5.4 Panneau de révision / Track Changes (3 jours)

Réutiliser le système natif d'ONLYOFFICE :

```typescript
// À chaque import distant, mapper les deltas sur le Track Changes sdkjs
loroDoc.subscribe((event) => {
  if (event.by === "import") {
    for (const textEvent of event.events.filter(e => e.target.kind === "Text")) {
      for (const delta of textEvent.diff) {
        if (delta.insert) {
          sdkApi.AddTrackChangeInsert(offset, delta.insert, authorName, authorId, Date.now());
        }
        if (delta.delete) {
          sdkApi.AddTrackChangeDelete(offset, delta.delete, authorName, authorId, Date.now());
        }
      }
    }
  }
});
```

**Fonctionnalités livrées** :
- Insertions distantes surlignées en couleur (1 couleur par auteur)
- Suppressions distantes barrées
- Boutons « Accepter » / « Rejeter » dans le panneau latéral natif
- Export des modifications en balises `<w:ins>` / `<w:del>` dans le .docx sauvegardé

---

## Phase 6 — Démo et POC (4 jours)

### 6.1 Intégration Seafile (2 jours)

| Tâche | Détail |
|---|---|
| Ouvrir un .docx depuis Seafile | Click sur un fichier → le navigateur charge le .docx, le parse via sdkjs, peuple le LoroDoc |
| Sauvegarder vers Seafile | Le client sérialise l'arbre Loro → reconstruit le .docx via sdkjs → pousse vers l'API Seafile |
| Verrouillage léger | Un fichier en cours d'édition est marqué « en co-édition Loro » dans Seafile (icône / badge) |

### 6.2 Documentation et démo live (2 jours)

| Livrable | Contenu |
|---|---|
| README.md | Architecture, prérequis, installation, déploiement Docker |
| Vidéo démo (3 min) | 3 navigateurs éditant le même .docx en temps réel |
| Document de benchmark | RAM serveur mesurée vs ONLYOFFICE Document Server classique |
| Feuille de route v2 | DrawingML, Calc/tableur, Impress/slides, mode P2P WebRTC |

---

## Récapitulatif des livrables par phase

| Phase | Durée | Livrable principal | Risque |
|---|---|---|---|
| **0 — Préparation** | 3j | Environnement de dev + CI + note juridique | Faible |
| **1 — Analyse sdkjs** | 5j | `sdkjs-dom-map.md` + `hooks-inventory.md` | Moyen |
| **2 — Binding Loro** | 6j | Package `@eurooffice/loro-bridge` testé | Moyen |
| **3 — Interception** | 11j | Mapper universel `arrayChanges` et Cold Start | **Élevé** |
| **4 — Serveur relais** | 7j | Container Docker `loro-relay` + persistance | Faible |
| **5 — Stabilisation** | 10j | Anti-écho, curseurs éphémères, Fuzz Testing | **Élevé** |
| **6 — Extensions & Démo** | 4j | Intégration Seafile, Tableur, Lazy Loading Images | Moyen |
| **7 — Desktop Editors** | 8j | Auto-découverte mDNS P2P (Node.js) | Moyen |

---

## Plan d'Exécution Détaillé (Checklist d'Implémentation)

Utilisez cette section pour suivre l'avancement concret du projet par rapport aux décisions documentées dans `architecture.md`.

### Phase 0 à 2 : Fondations
- [x] Initialiser le dépôt Vite (ESM + WASM) avec Loro CRDT (`package.json`, `vite.config.ts`).
- [x] Créer le Dockerfile de développement.
- [x] Rédiger la stratégie globale (`architecture.md`, `tests_strategy.md`).
- [x] Isoler le moteur réseau d'ONLYOFFICE (Monkey-Patching de `AscCommon.CDocsCoApi` via `Injector.ts`).
- [x] Définir la structure du Registre Plat (`LoroDocumentAdapter`).

### Phase 3 : Le Pont "Passe-Plat" et le Cold Start (Le MVP)
- [x] Créer la coquille vide de `ArrayChangesMapper.ts`.
- [x] Implémenter le hook de capture locale : router le flux `arrayChanges` vers le Mapper.
- [x] Implémenter le "Mutation Guard" (verrou anti-écho) pour bloquer les boucles de synchronisation.
- [x] Implémenter la structure arborescente avec `LoroTree` (remplace les LoroList).
- [x] Créer le tampon heuristique (debounce) pour convertir les Delete+Insert en `LoroTree.move()`.
- [x] Rédiger le code de désérialisation rapide (Cold Start : Loro ➔ JSON ➔ `FromJSON`).

**Cartographie des 15 codes vitaux (Le MVP) :**
- [x] Cartographier : Insertion et suppression de caractères (Text Runs).
- [x] Cartographier : Insertion et suppression de Paragraphes.
- [x] Cartographier : Propriétés de formatage Inline (Gras, Italique, Souligné, Police, Couleur).
- [x] Cartographier : Propriétés de Paragraphe (Alignement, Interligne, Marges).
- [ ] Cartographier : Création et suppression de Tableaux simples (Tables).
- [ ] Cartographier : Ajout et suppression de Lignes (Rows) et Cellules (Cells).
- [ ] Cartographier : Listes à puces et Numérotations (Numbering).

### Phase 3.5 : Cartographie exhaustive (La Cible Finale)
*Ces éléments sont purement du mapping JSON/Type. L'architecture réseau (MVP) n'a pas besoin d'être modifiée.*
- [ ] Cartographier : Fusion et division de cellules (`colspan` / `rowspan`).
- [ ] Cartographier : Images inline et Images ancrées (Flottantes).
- [ ] Cartographier : Formes vectorielles DrawingML (Shapes, Lignes, Connecteurs).
- [ ] Cartographier : En-têtes (Headers) et Pieds de page (Footers).
- [ ] Cartographier : Notes de bas de page (Footnotes) et de fin (Endnotes).
- [ ] Cartographier : Commentaires collaboratifs (Annotations).
- [ ] Cartographier : Hyperliens et Signets (Bookmarks).
- [ ] Cartographier : Table des matières automatique (TOC).
- [ ] Cartographier : Renvois et Références croisées (Cross-references).
- [ ] Cartographier : Équations Mathématiques (MathType/OMML).
- [ ] Cartographier : SmartArts (Arbres hiérarchiques complexes).
- [ ] Cartographier : Graphiques sectoriels/histogrammes (Charts).
- [ ] Cartographier : Objets OLE (ex: PDF ou Excel intégrés dans Word).
- [ ] Cartographier : Groupement d'objets (Group Shapes / Canvas).
- [ ] Cartographier : Contrôles de contenu (Content Controls / Formulaires).
- [ ] Cartographier : Sauts de page et Sauts de section.
- [ ] Cartographier : Filigranes (Watermarks).
- [ ] Cartographier : Thèmes du document (Jeux de couleurs/polices globaux).

### Phase 4 : Routeur Rust et Seafile
- [ ] Bootstraper le Routeur Rust (Axum + Tokio + WebSockets).
- [ ] Implémenter l'authentification aveugle (Validation JWT sans accès au contenu).
- [ ] Mettre en place le Blob Store (intercept. des uploads d'images ➔ Stockage temporaire ➔ Renvoi d'un Hash au client).
- [ ] Implémenter le "Client-Side Callback" : hooker le bouton "Sauvegarder" pour envoyer le snapshot final à Seafile.
- [ ] Mettre en place l'interception de l'historique Seafile pour restaurer le bouton natif ONLYOFFICE (Section 19.3).

### Phase 5 : Awareness, Tests et Optimisations
- [x] Créer le gestionnaire de "Lazy Loading / Frustum Culling" pour les images (`lazyImageLoader.ts`).
- [ ] Remplacer le `Undo/Redo` natif (Ctrl+Z) par l'API Time-Travel de Loro (Section 7.1).
- [ ] Câbler l'API native `CCollaborativeCursor` avec le canal éphémère (Awareness) pour les curseurs distants limités à 50ms.
- [ ] Implémenter le "Soft-Lock" visuel (Mode Strict émulé) via l'Awareness.
- [ ] Désactiver le chat interne (`customization.chat = false`) pour intégration Matrix.
- [ ] Rédiger la suite E2E Playwright de vérification de convergence.
- [ ] Mettre en place le Bot Node.js "Headless" pour la génération PDF côté serveur.

### Phase 6 & 7 : Multi-formats et Desktop
- [ ] Validation croisée du Mapper `ArrayChangesMapper.ts` sur Excel (`cell`) et PowerPoint (`slide`).
- [ ] Injecter le pont Loro dans l'environnement Chromium/Node.js de l'application Desktop.
- [ ] Implémenter la diffusion et l'écoute mDNS (Auto-découverte P2P locale).
- [ ] Gérer la bascule asynchrone (Mode Avion ➔ Internet) pour le routage de l'Awareness et du CRDT.

---

## MVP vs Extensions : clarification architecturale

> [!IMPORTANT]
> **L'architecture est intégralement posée par le MVP (Phases 0-6).** Tout le reste — plus de types de nœuds OOXML, le tableur, les slides — est du **travail incrémental de (dé)sérialisation**. Grâce à notre approche universelle (`arrayChanges`), nous n'avons **plus aucun hook métier à écrire**. Chaque nouveau type de nœud suit ce pattern extrêmement simple :
> 1. Jouer avec l'objet dans ONLYOFFICE et capturer les codes magiques émis dans `arrayChanges` (ex: `Type: 42` = Rotation).
> 2. Ajouter la traduction de ce code dans notre dictionnaire central `ArrayChangesMapper.ts`.
> 3. S'assurer que le pont de démarrage (Cold Start) génère bien la bonne structure JSON pour cet objet avant d'appeler `FromJSON`.
> 4. Écrire les tests de convergence (via Playwright) associés.
>
> **Aucune modification d'architecture** n'est nécessaire : le pont, le MutationGuard, le relais Rust et la persistance restent identiques pour tous les formats.

### Matrice de couverture des nœuds OOXML

> [!NOTE]
> **Propriétés génériques vs Structures spécifiques : Pourquoi cette matrice persiste-t-elle ?**
> Il est crucial de comprendre la nuance entre ce qui est automatisé par le pont et ce qui nécessite un travail humain :
> 
> **1. Ce qui EST 100% générique (Zéro effort)**
> Si ONLYOFFICE ajoute une nouvelle propriété visuelle simple (ex: "Ombre 3D"), `arrayChanges` émet un delta propre : `{ "Id": "para_1", "Prop": { "Shadow": true } }`. Notre pont prend l'objet `Prop` et l'injecte aveuglément dans Loro. Le réseau le synchronise automatiquement, sans que nous ayons besoin de savoir ce qu'est une Ombre 3D.
> 
> **2. Ce qui N'EST PAS générique (L'effort chiffré dans la matrice)**
> Dès que l'on touche à la hiérarchie ou à des objets métier complexes (Fusion de cellules, SmartArts, Graphiques Excel), ONLYOFFICE n'utilise plus de simples propriétés. 
> *   **Les actions cryptiques** : ONLYOFFICE émet des codes magiques (ex: `{ "Type": 58, "Id": "cell_1" }`). Il faut faire de la rétro-ingénierie pour deviner que `Type 58` veut dire "Fusion" et l'apprendre au `ArrayChangesMapper.ts`.
> *   **Le Cold Start (Démarrage à froid)** : Lors du chargement initial d'un document, ONLYOFFICE exige une structure JSON d'une précision chirurgicale pour la méthode `FromJSON`. Si nous ne connaissons pas l'anatomie exacte attendue par ONLYOFFICE pour un "Graphique Sectoriel", le pont ne saura pas le reconstruire depuis Loro et l'éditeur plantera.
> 
> Les jours estimés ci-dessous chiffrent donc **l'investigation de ces codes cryptiques et la maîtrise de l'anatomie JSON** de chaque nouvel objet lourd.

| Catégorie de nœuds | MVP | Extension | Complexité du mapping | Effort estimé |
|---|---|---|---|---|
| **Texte** (CRun, insertion/suppression) | ✅ | | — | — |
| **Formatage inline** (bold, italic, font) | ✅ | | — | — |
| **Styles de paragraphe** (titres, alignement) | ✅ | | — | — |
| **Tableaux simples** (ajout/suppression lignes) | ✅ | | — | — |
| Fusion/division de cellules | | ✅ | Élevée (colspan/rowspan) | 3-4j |
| En-têtes, pieds de page | | ✅ | Moyenne (conteneurs séparés) | 2-3j |
| Notes de bas de page / de fin | | ✅ | Moyenne (ancrage + conteneur) | 2j |
| Commentaires collaboratifs | | ✅ | Faible (LoroMap + ancre texte) | 2-3j |
| Images inline et ancrées | | ✅ | Moyenne (position, habillage) | 3-4j |
| Formes vectorielles (DrawingML) | | ✅ | Élevée (géométrie, connecteurs) | 5-7j |
| SmartArts | | ✅ | Très élevée (arbre de layout) | 5-7j |
| **Tableur** (`cell/` — grille, formules) | | ✅ | Élevée (DAG de dépendances) | 2-3 sem |
| **Présentations** (`slide/` — calques, transitions) | | ✅ | Élevée (z-order, animations) | 2-3 sem |
| Export PDF côté client (WASM) | | ✅ | Indépendant (moteur de rendu) | 1-2 sem |

> [!TIP]
> Chaque ligne "Extension" est un sprint autonome de 2-7 jours qui réutilise 100% de l'infrastructure MVP. On peut les paralléliser ou les prioriser selon les besoins métier.

---

## Phase 7 — Intégration Desktop Editors (8 jours)

### Pourquoi c'est beaucoup plus simple que prévu (avec un bémol pour le P2P)

DesktopEditors embarque **Chromium/CEF complet**. Ce n'est pas un binaire C++ natif avec ses propres APIs réseau : c'est un navigateur web encapsulé. Par conséquent :

> [!IMPORTANT]
> **Le transport réseau (client) est strictement identique au web.** WebSocket et WebRTC fonctionnent dans Chromium/CEF exactement comme dans Chrome/Firefox. L'accès direct au système de fichiers (API `fs` de Node.js) permet la persistance `.loro` locale.

Cependant, **pour l'auto-découverte P2P purement hors-ligne** (le scénario de l'avion sans aucun routeur internet) : WebRTC a *toujours* besoin d'échanger des coordonnées initiales (Signaling). Sans internet, les API web classiques sont bloquées. C'est ici que l'accès à **Node.js** devient vital.

### 7.1 Fork, build et injection (3 jours)

| Tâche | Détail |
|---|---|
| Cloner `ONLYOFFICE/DesktopEditors` | Identifier le point d'injection dans le renderer Chromium |
| Injecter `@eurooffice/loro-bridge` | Même package npm que le web, chargé dans le `preload.js` ou `renderer.js` |
| Brancher le `LoroSyncManager` | **Identique au web** — WebSocket vers le relais Rust distant |
| Valider | Ouvrir un .docx, co-éditer avec un navigateur web standard → les deux convergent |

### 7.2 Branchement sur l'UI offline existante (2 jours)

DesktopEditors possède déjà une interface de gestion (connecté/déconnecté, sauvegarde locale).

| Tâche | Détail |
|---|---|
| Mapper les événements Loro sur l'UI | `loroSync.onStatusChange` → mettre à jour l'indicateur natif |
| Persistance `.loro` sur disque | Utiliser `fs` pour sauvegarder le snapshot Loro (à côté des fichiers de récupération) |
| Sync au retour en ligne | Au rétablissement du WebSocket distant : envoi automatique des deltas accumulés |

### 7.3 Auto-découverte P2P hors-ligne (avion) (3 jours)

Pour que deux collègues dans le même avion puissent collaborer de manière "magique" sans configurer d'IP :

| Tâche | Détail |
|---|---|
| Diffusion mDNS (Bonjour) | L'instance Electron utilise Node.js pour diffuser un signal local : *"J'édite le doc_123 sur l'IP 192.168.X.X"* |
| Mini-serveur local | Si aucun relais n'est trouvé, Node.js ouvre un port local (WebSocket server) |
| Connexion P2P directe | Le client qui capte le signal mDNS s'y connecte directement en WebSocket local (ou échange les offres WebRTC via ce canal) |

### Livrables Phase 7

| Livrable | Description |
|---|---|
| Build DesktopEditors + Loro | Installeur `.deb`/`.AppImage` fonctionnel |
| Démo offline/online | Vidéo : édition hors-ligne → reconnexion → fusion automatique |
| Démo P2P Avion | Vidéo : auto-découverte (mDNS) et co-édition sans aucune connexion internet |

---

## Récapitulatif mis à jour

| Phase | Durée | Nature du travail | Risque |
|---|---|---|---|
| **0 — Préparation** | 3j | Outillage | Faible |
| **1 — Analyse sdkjs** | 5j | Reverse engineering | Moyen |
| **2 — Binding Loro** | 6j | **Architecture** (schéma CRDT + pont) | Moyen |
| **3 — Interception** | 11j | **Architecture** (hooks + anti-écho) | **Élevé** |
| **4 — Serveur relais** | 7j | **Architecture** (transport + persistance) | Faible |
| **5 — Stabilisation** | 10-13j | **Architecture** (curseurs, fuzz, Track Changes) | **Élevé** |
| **6 — Démo Web** | 4j | Intégration | Faible |
| **7 — Desktop Editors** | 8j | Intégration + **Découverte P2P Node.js** | **Moyen** |
| **TOTAL** | **~8-9 semaines** | | |
| **Extensions nœuds** | 2-7j / type | **Sérialisation** (pattern identique, pas d'archi) | Faible |

---

## Profils requis

| Rôle | Compétences | Temps |
|---|---|---|
| **Lead Architecte** (1 personne) | TypeScript avancé, Rust, WASM, systèmes distribués, OOXML | 100% sur 8-9 semaines |
| **Ingénieur Rust** (1 personne, Phase 4) | Axum, Tokio, protocoles binaires, Docker | 50% sur 2 semaines |
| **Ingénieur Node.js / Electron** (1 personne, Phase 7) | Réseau local, mDNS/Bonjour, intégration système | 50% sur 1 semaine |
| **Agent LLM** (outillage permanent) | Reverse engineering sdkjs, génération de tests, boilerplate FFI | Continu |

> [!TIP]
> Avec un seul développeur senior augmenté par un agent LLM, le tout est réalisable en **8-9 semaines**. Les extensions de nœuds OOXML peuvent ensuite être déléguées à des développeurs juniors puisque le pattern est mécanique.

### Alternative : Mode Solo / Hobbyist (sans équipe d'experts)

Si vous n'avez pas d'équipe d'ingénieurs et que vous réalisez ce projet en solo (par curiosité technique ou besoin spécifique), l'approche change radicalement grâce aux agents LLM spécialisés. Les "profils requis" ci-dessus deviennent des *rôles* virtuels incarnés par l'IA.

**Nouvelle répartition des rôles :**

*   **Vous (Le "Tech Lead" / Testeur) :**
    *   Vous orchestrez le projet et définissez les priorités (ex: "Faisons juste le texte pour commencer").
    *   Vous exécutez le code généré sur votre machine, testez l'application dans votre navigateur, et remontez les logs/erreurs à l'IA.
    *   Vous validez les choix d'expérience utilisateur (UX).
*   **L'Agent LLM (L'équipe de développement) :**
    *   **Dev Rust :** Rédige le serveur relais complet (Axum/Tokio), gère la persistance et l'optimisation mémoire.
    *   **Dev TypeScript :** Crée les bindings WASM, gère la synchronisation Loro et l'auto-découverte (mDNS).
    *   **Reverse Engineer :** Analyse le code source natif de `sdkjs` (fichiers de 4000 lignes) pour trouver exactement à quelle ligne injecter les hooks d'interception, sans que vous n'ayez à lire le code legacy.

Ce projet est le candidat idéal pour un duo Humain-IA car l'architecture est très modulaire : le serveur Rust est isolé, la logique CRDT est packagée, et l'injection dans ONLYOFFICE est chirurgicale. Il peut être réalisé par itérations courtes (le week-end par exemple), étape par étape.
