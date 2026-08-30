# Inventaire des Hooks de Mutation (Phase 1.3)

Ce document liste exhaustivement les méthodes du moteur `sdkjs` qui devront être "monkey-patchées" (interceptées) pour capturer les modifications locales de l'utilisateur et les transmettre au CRDT Loro.

## 1. Mutations Textuelles (Les plus critiques)

### A. Insertion de Texte
C'est la méthode de base appelée lorsqu'un utilisateur tape au clavier.
*   **Classe** : `CParagraph` (dans `word/Editor/Paragraph.js`)
*   **Méthode cible** : `Internal_Content_Add(pos, item)`
*   **Action Loro correspondante** : Trouver l'index du paragraphe, calculer l'offset UTF-8 global, et appeler `LoroText.insert()`.

### B. Suppression de Texte
Appelée lors de l'appui sur Retour Arrière ou Suppr.
*   **Classe** : `CParagraph`
*   **Méthode cible** : `Internal_Content_Remove(pos, count)`
*   **Action Loro correspondante** : `LoroText.delete()`

### C. Découpage (Split) et Fusion (Merge) de Runs
SDKJS gère le formatage en découpant les chaînes de texte continues (`CRun`). Lorsqu'un style change au milieu d'un mot, sdkjs coupe le `CRun` en deux. **Ceci ne doit PAS générer d'insertion/suppression dans Loro.**
*   **Méthode cible** : `CParagraph.prototype.SplitRun(runIndex, offset)`
*   **Action Loro** : *Ignorer* (filtrer grâce au `MutationGuard`), car le contenu textuel total ne change pas.

## 2. Formatage Inline (Gras, Italique, Polices)

*   **Classe** : `CRun` (dans `word/Editor/Run.js`)
*   **Méthodes cibles** : 
    *   `SetBold(value)`
    *   `SetItalic(value)`
    *   `SetFontSize(value)`
    *   `SetColor(value)`
    *   `SetHighlight(color)`
*   **Action Loro correspondante** : `LoroText.mark({start, end}, "bold", true)`
*   **Défi technique** : SDKJS modifie la propriété sur l'objet `CRun` entier. Il faudra déduire la plage `{start, end}` à partir de la position du `CRun` dans le `CParagraph` parent.

## 3. Structure de Blocs (Paragraphes)

*   **Classe** : `CParagraph`
*   **Méthodes cibles** :
    *   `SetStyle(styleId)`
    *   `SetAlignment(alignType)`
    *   `SetSpacing(spacingObj)`
*   **Action Loro correspondante** : Récupérer la `LoroMap` représentant ce paragraphe dans le `LoroDoc`, et appeler `map.set("alignment", "center")`.

## 4. Stratégie d'Interception (Monkey-Patching miroir)

Plutôt que d'avoir un fichier géant, nous organiserons nos fichiers d'interception en **miroir parfait de l'arborescence de sdkjs**.
Par exemple, pour `CParagraph` (qui est dans `word/Editor/Paragraph.js`), l'interception se fera dans le fichier `loro_sync/src/hooks/word/Editor/Paragraph.ts` :

```typescript
function patchParagraphAdd() {
    const originalAdd = window.CParagraph.prototype.Internal_Content_Add;
    
    window.CParagraph.prototype.Internal_Content_Add = function(pos, item) {
        // 1. Exécuter la fonction d'origine pour ne pas casser le rendu
        const result = originalAdd.call(this, pos, item);
        
        // 2. Si on n'est pas en train de rejouer un événement Loro (Anti-écho)
        if (mutationGuard.isLocal()) {
            const text = item.getText();
            const globalOffset = calculateGlobalOffset(this, pos);
            loroSyncManager.broadcastInsert(globalOffset, text);
        }
        
        return result;
    }
}
```

## 5. Tableaux (Tables)
*   **Classes** : `CTable`, `CTableRow`, `CTableCell` (dans `word/Editor/Table.js`)
*   **Méthodes cibles** : `AddRow()`, `RemoveRow()`, `AddColumn()`, `RemoveColumn()`
*   **Action Loro** : Création de conteneurs `LoroList` encapsulés dans des `LoroMap` pour modéliser la grille bidimensionnelle, avec l'insertion récursive de paragraphes à l'intérieur des cellules.

## 6. Images et Dessins (DrawingML)
*   **Classes** : `CDrawing`, `CShape`, `CImage` (dans `word/Drawing/`)
*   **Méthodes cibles** : `SetPosition(x, y)`, `SetSize(w, h)`, `ChangeImage(url)`
*   **Action Loro** : Modification de propriétés dans une `LoroMap` (ex: `map.set("width", 500)`). Les blobs d'images eux-mêmes ne seront pas stockés dans Loro (trop lourd), mais l'URL ou un hash pointant vers le serveur de fichiers statique le sera.

## 7. Sélections et Curseurs (Awareness)
*   **Classes** : `CLogicDocument` (méthode `UpdateSelection()`)
*   **Méthodes cibles** : `MoveCursorRight()`, `MoveCursorLeft()`, `SetSelect()`
*   **Action Loro** : Utilisation du composant *Awareness* (hors de l'arbre CRDT principal, via un state éphémère WebRTC/WebSocket) pour diffuser la position `(startOffset, endOffset)` et afficher les curseurs colorés des autres utilisateurs.

## 8. Historique (Undo/Redo)
*   **Classe** : `CHistory` (dans `word/document/History.js`)
*   **Méthodes cibles** : `AddCommand()`, `Undo()`, `Redo()`
*   **Action Loro** : Désactiver le Undo/Redo natif de sdkjs (`CHistory`). Loro gère nativement le Undo/Redo au niveau CRDT via `loroDoc.undo()`. Il faudra intercepter `Ctrl+Z` pour déclencher le `undo()` de Loro et provoquer un rechargement partiel (`Recalculate()`).

## 9. Sections et Mise en Page (Marges, Tailles de page)
*   **Classe** : `CSection`
*   **Méthodes cibles** : `SetPageSize(w, h)`, `SetMargin(l, t, r, b)`
*   **Action Loro** : Mise à jour d'une racine globale `LoroMap` contenant les métadonnées globales du document (styles de page, orientation, en-têtes/pieds-de-page).
