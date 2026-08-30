import { LoroDoc, LoroTree } from "loro-crdt";
import { LoroDocumentAdapter } from "./LoroDocumentAdapter";

export interface OOAscChange {
    Type: number;
    Id?: string;
    ParentId?: string;
    Props?: Record<string, any>;
    [key: string]: any;
}

// Déclarations globales pour TypeScript pour accéder aux constantes internes d'ONLYOFFICE
declare global {
    interface Window {
        AscDFH?: any; // Engine Word & Slide
        AscCH?: any;  // Engine Excel (Cell)
    }
}

export class ArrayChangesMapper {
    private doc: LoroDoc;
    private adapter: LoroDocumentAdapter;
    public domTree: LoroTree;
    private mutationGuard: boolean = false;

    constructor(adapter: LoroDocumentAdapter) {
        this.adapter = adapter;
        this.doc = adapter.getDoc();
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
        // Logique de consolidation des déplacements (Remove -> Add = Move)
        const result: OOAscChange[] = [];
        const deletes = new Map<string, number>();

        for (let i = 0; i < changes.length; i++) {
            const change = changes[i];
            
            // On s'assure que les variables globales sont chargées
            const AscDFH = window.AscDFH || {};
            const AscCH = window.AscCH || {};

            if (change.Type === AscDFH.historyitem_ParaRun_RemoveItem && change.Id) {
                deletes.set(change.Id, result.length);
                result.push(change);
            }
            else if (change.Type === AscDFH.historyitem_ParaRun_AddItem && change.Id && deletes.has(change.Id)) {
                const delIndex = deletes.get(change.Id)!;
                result[delIndex] = { Type: 9999, Id: change.Id, ParentId: change.ParentId }; // Move
                deletes.delete(change.Id);
            } 
            else {
                result.push(change);
            }
        }
        return result;
    }

    private processChange(change: OOAscChange) {
        const AscDFH = window.AscDFH || {};
        const AscCH = window.AscCH || {};

        switch (change.Type) {
            // ==========================================
            // WORD (DOCUMENT) - Moteur AscDFH
            // ==========================================

            // --- Texte ---
            case AscDFH.historyitem_ParaRun_AddItem:
                if (change.Id && change.Text !== undefined && change.Offset !== undefined) {
                    this.adapter.insertText(change.Id, change.Offset, change.Text);
                }
                break;
            case AscDFH.historyitem_ParaRun_RemoveItem:
                if (change.Id && change.Length !== undefined && change.Offset !== undefined) {
                    this.adapter.deleteText(change.Id, change.Offset, change.Length);
                }
                break;

            // --- Formatage Texte (Bold, Italic, Color...) ---
            case AscDFH.historyitem_ParaRun_Bold:
            case AscDFH.historyitem_ParaRun_Italic:
            case AscDFH.historyitem_ParaRun_FontSize:
            case AscDFH.historyitem_ParaRun_Color:
                if (change.Id && change.Props) {
                    for (const [key, value] of Object.entries(change.Props)) {
                        this.adapter.setNodeProperty(change.Id, key, value);
                    }
                }
                break;

            // --- Paragraphes ---
            case AscDFH.historyitem_Paragraph_AddItem:
                if (change.Id) {
                    this.adapter.registerNode(change.Id, "Paragraph");
                    if (change.ParentId) try { this.domTree.createNode(change.ParentId); } catch(e){}
                }
                break;
            case AscDFH.historyitem_Paragraph_RemoveItem:
                if (change.Id) { /* Supprimer le nœud */ }
                break;

            // --- Tableaux (Word & PPT) ---
            case AscDFH.historyitem_Table_AddRow:
                if (change.Id) this.adapter.registerNode(change.Id, "TableRow");
                break;
            case AscDFH.historyitem_TableRow_AddCell:
                if (change.Id) this.adapter.registerNode(change.Id, "TableCell");
                break;
            case AscDFH.historyitem_TableCell_GridSpan: // ColSpan / RowSpan
                if (change.Id && change.SpanProps) {
                    this.adapter.setNodeProperty(change.Id, "ColSpan", change.SpanProps.ColSpan);
                    this.adapter.setNodeProperty(change.Id, "RowSpan", change.SpanProps.RowSpan);
                }
                break;

            // --- Images et Formes (DrawingML) ---
            case AscDFH.historyitem_type_ImageShape: // Images
            case AscDFH.historyitem_Drawing_SetGraphicObject:
                if (change.Id && change.ImageHash) {
                    this.adapter.registerNode(change.Id, "Image");
                    this.adapter.setNodeProperty(change.Id, "BlobHash", change.ImageHash);
                    this.adapter.setNodeProperty(change.Id, "Width", change.Width);
                    this.adapter.setNodeProperty(change.Id, "Height", change.Height);
                }
                break;

            case AscDFH.historyitem_type_Shape: // Formes Vectorielles
                if (change.Id && change.ShapeType) {
                    this.adapter.registerNode(change.Id, "Shape");
                    this.adapter.setNodeProperty(change.Id, "Geometry", change.ShapeType);
                }
                break;

            // --- SmartArts & Objets Complexes ---
            case AscDFH.historyitem_type_OleObject: // Fichiers OLE incrustés
                if (change.Id && change.OleDataHash) {
                    this.adapter.registerNode(change.Id, "OleObject");
                    this.adapter.setNodeProperty(change.Id, "DataHash", change.OleDataHash);
                }
                break;
            case AscDFH.historyitem_Chart_SetChartData: // Graphiques Sectoriels
                if (change.Id && change.ChartData) {
                    this.adapter.registerNode(change.Id, "Chart");
                    this.adapter.setNodeProperty(change.Id, "DataSeries", change.ChartData);
                }
                break;

            // --- Mathématiques ---
            case AscDFH.historyitem_MathContent_AddItem:
                if (change.Id && change.OmmlString) {
                    this.adapter.registerNode(change.Id, "MathEquation");
                    this.adapter.setNodeProperty(change.Id, "Omml", change.OmmlString);
                }
                break;

            // --- Annotations & Commentaires ---
            case AscDFH.historyitem_Comment_Change:
                if (change.Id && change.CommentText) {
                    this.adapter.registerNode(change.Id, "Comment");
                    this.adapter.setNodeProperty(change.Id, "Text", change.CommentText);
                    this.adapter.setNodeProperty(change.Id, "Author", change.Author);
                }
                break;

            // ==========================================
            // EXCEL (CELL) - Moteur AscCH
            // ==========================================
            case AscCH.historyitem_Workbook_SheetAdd:
                if (change.Id) this.adapter.registerNode(change.Id, "Sheet");
                break;
            
            case AscCH.historyitem_Worksheet_ChangeFrozenCell:
            case AscCH.historyitem_Worksheet_ColProp:
                if (change.Id) {
                    this.adapter.setNodeProperty(change.Id, "CellValue", change.Value);
                    this.adapter.setNodeProperty(change.Id, "Formula", change.Formula);
                }
                break;

            // ==========================================
            // POWERPOINT (SLIDE) - Moteur AscDFH / AscSH
            // ==========================================
            case AscDFH.historyitem_Presentation_AddSlide:
                if (change.Id) this.adapter.registerNode(change.Id, "Slide");
                break;
            case AscDFH.historyitem_Presentation_ChangeTheme:
                if (change.Id) this.adapter.setNodeProperty(change.Id, "Theme", change.ThemeId);
                break;

            // ==========================================
            // LOGIQUE COMMUNE (Déplacement LoroTree)
            // ==========================================
            case 9999: // Déplacement personnalisé (Move) calculé par le HeuristicDebounce
                if (change.Id && change.ParentId) {
                    try { /* this.domTree.move(change.Id, change.ParentId); */ } catch (e) {}
                }
                break;

            default:
                // Pour attraper les codes non répertoriés
                // console.warn("Code OOOXML non mappé intercepté :", change.Type);
                break;
        }
    }
}
