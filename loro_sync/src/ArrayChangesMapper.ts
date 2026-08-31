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

        // ==========================================
        // LE PONT "PASSE-PLAT" AVEUGLE
        // ==========================================
        // Finie la rétro-ingénierie ! Nous n'avons plus besoin de cartographier 
        // les 1250 types de nœuds (Tableaux, SmartArts, Graphiques...).
        // Nous traduisons uniquement les 5 primitives structurelles :

        // 1 & 2. Primitives Textuelles (Nécessite LoroText pour éviter les conflits spatiaux d'index)
        if (change.Text !== undefined && change.Offset !== undefined && change.Id) {
            this.adapter.insertText(change.Id, change.Offset, change.Text);
            return;
        }
        if (change.Length !== undefined && change.Offset !== undefined && change.Id) {
            this.adapter.deleteText(change.Id, change.Offset, change.Length);
            return;
        }

        // 3. Primitive de Déplacement (Move) calculée par le HeuristicDebounce
        if (change.Type === 9999 && change.Id && change.ParentId) {
            try { this.domTree.move(change.Id, change.ParentId); } catch (e) {}
            return;
        }

        // 4 & 5. Création de Nœuds et Mise à jour de Propriétés (Agnostique)
        if (change.Id) {
            // Création aveugle dans l'arbre si c'est un nouveau nœud
            try { this.adapter.registerNode(change.Id, "OOXML_Node"); } catch (e) {}

            // Passe-Plat : on stocke le payload JSON générique brut sur le nœud.
            // Le destinataire récupérera ce JSON et le redonnera à ONLYOFFICE nativement.
            if (change.Props) {
                for (const [key, value] of Object.entries(change.Props)) {
                    this.adapter.setNodeProperty(change.Id, key, value);
                }
            } else {
                // Si c'est une commande cryptique (ex: Type: 58 pour Fusion), on la stocke telle quelle
                this.adapter.setNodeProperty(change.Id, `raw_delta_${change.Type}`, change);
            }
        }
    }
}
