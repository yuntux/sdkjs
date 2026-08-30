import { LoroDoc, LoroTree } from "loro-crdt";
import { LoroDocumentAdapter } from "./LoroDocumentAdapter";

export interface OOAscChange {
    Type: number;
    Id?: string;
    ParentId?: string;
    Props?: Record<string, any>;
    [key: string]: any;
}

export class ArrayChangesMapper {
    private doc: LoroDoc;
    private adapter: LoroDocumentAdapter;
    public domTree: LoroTree;
    private mutationGuard: boolean = false; // Anti-écho

    constructor(adapter: LoroDocumentAdapter) {
        this.adapter = adapter;
        this.doc = adapter.getDoc();
        // Le LoroTree est récupéré depuis l'adaptateur pour partager la même instance
        this.domTree = this.doc.getTree("dom"); 
    }

    public lock() { this.mutationGuard = true; }
    public unlock() { this.mutationGuard = false; }

    public applyLocalChangesToLoro(changes: OOAscChange[]) {
        if (this.mutationGuard) return;

        const consolidatedChanges = this.heuristicMoveDebounce(changes);

        for (const change of consolidatedChanges) {
            this.processChange(change);
        }

        this.doc.commit();
    }

    private heuristicMoveDebounce(changes: OOAscChange[]): OOAscChange[] {
        const result: OOAscChange[] = [];
        const deletes = new Map<string, number>();

        for (let i = 0; i < changes.length; i++) {
            const change = changes[i];

            // Type 54 (Delete) et Type 24 (Insert) sont des exemples de mapping structurel
            if (change.Type === 54 && change.Id) {
                deletes.set(change.Id, result.length);
                result.push(change);
            }
            else if (change.Type === 24 && change.Id && deletes.has(change.Id)) {
                const delIndex = deletes.get(change.Id)!;
                result[delIndex] = { Type: 9999, Id: change.Id, ParentId: change.ParentId };
                deletes.delete(change.Id);
            } 
            else {
                result.push(change);
            }
        }
        return result;
    }

    private processChange(change: OOAscChange) {
        switch (change.Type) {
            case 0: // 📝 Insertion de texte (Text Runs)
                if (change.Id && change.Text !== undefined && change.Offset !== undefined) {
                    this.adapter.insertText(change.Id, change.Offset, change.Text);
                }
                break;

            case 1: // ✂️ Suppression de texte
                if (change.Id && change.Length !== undefined && change.Offset !== undefined) {
                    this.adapter.deleteText(change.Id, change.Offset, change.Length);
                }
                break;

            case 14: // 🎨 Formatage Inline (Gras, Italique, Police, etc.)
                if (change.Id && change.Props) {
                    for (const [key, value] of Object.entries(change.Props)) {
                        this.adapter.setNodeProperty(change.Id, key, value);
                    }
                }
                break;

            case 24: // ➕ Insertion d'un Paragraphe / Élément
                if (change.Id && change.NodeType) {
                    this.adapter.registerNode(change.Id, change.NodeType);
                    if (change.ParentId) {
                        try { this.domTree.createNode(change.ParentId); /* Stub de rattachement */ } catch(e){}
                    }
                }
                break;

            case 9999: // 🚀 Action Virtuelle : Déplacement (Move)
                if (change.Id && change.ParentId) {
                    try {
                        // this.domTree.move(change.Id, change.ParentId); // API LoroTree réelle
                    } catch (e) {
                        console.error("Erreur de déplacement LoroTree", e);
                    }
                }
                break;

            case 30: // 📊 Création de Tableau
                if (change.Id && change.Rows && change.Cols) {
                    const tableMap = this.adapter.registerNode(change.Id, "Table");
                    tableMap.set("rows", change.Rows);
                    tableMap.set("cols", change.Cols);
                    if (change.ParentId) {
                        try { this.domTree.createNode(change.ParentId); } catch(e){}
                    }
                }
                break;

            case 31: // ➖ Ajout de ligne (Row)
                if (change.Id && change.TableId) {
                    this.adapter.registerNode(change.Id, "TableRow");
                }
                break;

            case 32: // 🔲 Ajout de cellule (Cell)
                if (change.Id && change.RowId) {
                    this.adapter.registerNode(change.Id, "TableCell");
                }
                break;

            case 40: // 🔢 Listes et Numérotations (Numbering)
                if (change.Id && change.Level !== undefined) {
                    this.adapter.setNodeProperty(change.Id, "ListLevel", change.Level);
                    this.adapter.setNodeProperty(change.Id, "ListType", change.ListType || "Bullet");
                }
                break;

            case 80: // 📊 [EXCEL] Modification d'une cellule (Spreadsheet)
                if (change.Id && change.Value !== undefined) {
                    this.adapter.setNodeProperty(change.Id, "CellValue", change.Value);
                    if (change.Formula) {
                        this.adapter.setNodeProperty(change.Id, "Formula", change.Formula);
                    }
                }
                break;

            case 90: // 📽️ [POWERPOINT] Insertion d'une diapositive (Slide)
                if (change.Id && change.SlideIndex !== undefined) {
                    const slideMap = this.adapter.registerNode(change.Id, "Slide");
                    slideMap.set("index", change.SlideIndex);
                    // Raccordement à l'arbre des slides
                    if (change.ParentId) {
                        try { this.domTree.createNode(change.ParentId); } catch(e){}
                    }
                }
                break;

            default:
                // Ignorer silencieusement pour le moment les types non cartographiés (Phase 3.5)
                break;
        }
    }
}
