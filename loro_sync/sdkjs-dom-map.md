# Cartographie du Modèle Objet OOXML (sdkjs)

## 1. Localisation des Classes Clés

Contrairement à ce qu'on pourrait penser, la majorité de la logique métier du document pour l'éditeur Word n'est pas dans `word/document/`, mais dans **`word/Editor/`**. 

Voici la hiérarchie principale qui constitue l'arbre DOM interne de sdkjs :

```
word/Editor/
├── Document.js             (Racine de l'arbre, gère les sections et le document complet)
├── DocumentContent.js      (Conteneur générique pour le contenu d'un flux - body, header, footer)
├── Paragraph.js            (Bloc de paragraphe, contient des éléments en ligne)
├── Run.js                  (Segment de texte avec un formatage homogène)
├── Table.js                (Structure tabulaire de haut niveau)
├── Table/TableRow.js       (Ligne d'un tableau)
├── Table/TableCell.js      (Cellule, qui contient un DocumentContent)
├── History.js              (Système d'Undo/Redo et gestion des transactions)
├── Styles.js               (Gestionnaire des styles globaux du document)
└── Serialize2.js           (Moteur de sérialisation interne / vers binaire)
```

## 2. Cycle de vie d'une Mutation

Lorsque l'utilisateur interagit avec l'interface, les événements sont capturés et transformés en appels d'API sur cet arbre DOM. 
Le cycle typique est le suivant :

1. **Mutation** : Une méthode de classe est appelée (ex: `run.AddText("bonjour")`).
2. **Transaction** : L'action est souvent enregistrée dans `CHistory` pour permettre le Undo/Redo.
3. **Dirty Flags** : Le nœud modifié (et ses parents) est marqué comme "sale" (dirty).
4. **Recalculate** : Le moteur recalcule la mise en page (word-wrapping, positions) lors du prochain tick d'animation. (ex: `Paragraph_Recalculate.js`).
5. **Draw** : Le résultat est dessiné sur le `<canvas>` HTML5.

## 3. Inventaire des Points d'Interception (Hooks Loro)

Pour synchroniser ce modèle avec un CRDT Loro, nous devrons faire du *Monkey-Patching* ou utiliser les événements natifs sur ces méthodes clés.

### A. Mutations de Texte (Run & Paragraph)
Ces méthodes modifient le contenu textuel pur. Elles devront être mappées vers `LoroText.insert()` et `LoroText.delete()`.

*   `CRun.prototype.AddText(text)`
*   `CRun.prototype.RemoveText(start, length)`
*   `CParagraph.prototype.Internal_Content_Add(pos, item)`
*   `CParagraph.prototype.Internal_Content_Remove(pos, count)`
*   `CParagraph.prototype.SplitRun(runIndex, offset)`

### B. Formatage Inline (Run)
Ces méthodes modifient les propriétés visuelles d'un segment de texte. Elles seront mappées vers `LoroText.mark()`.

*   `CRun.prototype.SetBold(value)`
*   `CRun.prototype.SetItalic(value)`
*   `CRun.prototype.SetFontSize(value)`
*   `CRun.prototype.SetColor(value)`
*   *Note : sdkjs modifie souvent les propriétés en créant/scindant des CRun. Loro applique des `marks` sur une plage d'index.*

### C. Structure de Blocs (Paragraph & Styles)
Ces méthodes affectent les propriétés d'un bloc entier. Elles seront mappées vers des `LoroMap` (ex: `paraMap.set("alignment", "center")`).

*   `CParagraph.prototype.SetStyle(styleId)`
*   `CParagraph.prototype.SetAlignment(alignType)`
*   `CParagraph.prototype.SetSpacing(spacingObj)`

### D. Tableaux (Table)
Les tableaux sont la structure la plus complexe à mapper (nécessite des `LoroList` de `LoroList`).

*   `CTable.prototype.AddRow(index)`
*   `CTable.prototype.AddColumn(index)`
*   `CTable.prototype.RemoveRow(index)`
*   `CTable.prototype.MergeCells(startRow, startCol, endRow, endCol)`

## 4. Prochaine étape

La Phase 2 consiste à créer le binding `LoroDocumentAdapter` dans un dossier Typescript isolé, capable de reproduire virtuellement cet arbre à l'aide des types `LoroDoc`, `LoroList`, `LoroText` et `LoroMap`.
