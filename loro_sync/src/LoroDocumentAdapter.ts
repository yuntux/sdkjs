import { Loro, LoroList, LoroMap, LoroText, LoroTree, LoroTreeNode } from "loro-crdt";

/**
 * LoroDocumentAdapter - L'Adaptateur Universel avec LoroTree
 * 
 * Maintient le registre plat des propriétés et l'arborescence (LoroTree).
 * Génère également le JSON pour le Cold Start (Démarrage à froid).
 */
export class LoroDocumentAdapter {
    private doc: Loro;
    private nodes: LoroMap; // Registre plat des propriétés (InternalId -> LoroMap)
    private domTree: LoroTree; // Hiérarchie structurelle du document
    
    private rootId: string = "root";

    constructor(existingDoc?: Loro) {
        this.doc = existingDoc || new Loro();
        this.nodes = this.doc.getMap("nodes");
        this.domTree = this.doc.getTree("dom");
        
        if (!this.nodes.has(this.rootId)) {
            // Création de la racine du registre
            const rootNode = new LoroMap();
            rootNode.set("type", "document_body");
            rootNode.setContainer("props", new LoroMap());
            this.nodes.setContainer(this.rootId, rootNode);
            
            // Création du nœud racine dans l'arbre (le parent de tout)
            // LoroTree génère ses propres IDs, nous gérons la correspondance si besoin.
            this.doc.commit();
        }
    }

    public getDoc(): Loro {
        return this.doc;
    }

    /**
     * Crée ou met à jour les propriétés d'un nœud dans le registre plat.
     */
    public registerNode(internalId: string, nodeType: string): LoroMap {
        if (!this.nodes.has(internalId)) {
            const nodeMap = new LoroMap();
            nodeMap.set("type", nodeType);
            nodeMap.setContainer("props", new LoroMap());
            
            if (nodeType === "Run" || nodeType === "Text") {
                nodeMap.setContainer("text", new LoroText());
            }

            this.nodes.setContainer(internalId, nodeMap);
        }
        return this.nodes.get(internalId) as LoroMap;
    }

    /**
     * Met à jour une propriété (Gras, Italique, Taille...) sur un nœud.
     */
    public setNodeProperty(internalId: string, propKey: string, propValue: any): void {
        const node = this.nodes.get(internalId) as LoroMap;
        if (!node) return;
        
        const props = node.get("props") as LoroMap;
        props.set(propKey, propValue);
    }

    public insertText(internalId: string, offset: number, text: string): void {
        const node = this.nodes.get(internalId) as LoroMap;
        if (!node) return;
        const loroText = node.get("text") as LoroText;
        if (loroText) loroText.insert(offset, text);
    }

    public deleteText(internalId: string, offset: number, length: number): void {
        const node = this.nodes.get(internalId) as LoroMap;
        if (!node) return;
        const loroText = node.get("text") as LoroText;
        if (loroText) loroText.delete(offset, length);
    }

    // --- COLD START (Démarrage à Froid) ---

    /**
     * Reconstruit l'objet JSON complet attendu par la méthode native FromJSON d'ONLYOFFICE.
     * C'est ici que réside "l'effort d'anatomie" (Phase 3.5).
     */
    public buildJsonForColdStart(): any {
        // En théorie, LoroTree retourne ses racines via domTree.roots()
        const roots = this.domTree.roots();
        if (roots.length === 0) return {}; // Document vide

        // On démarre la construction récursive depuis la racine
        return this.buildJsonRecursive(roots[0]);
    }

    private buildJsonRecursive(treeNode: LoroTreeNode): any {
        const internalId = treeNode.id as unknown as string; // Identifiant mappé
        const nodeData = this.nodes.get(internalId) as LoroMap;
        
        if (!nodeData) return {};

        const type = nodeData.get("type") as string;
        const props = (nodeData.get("props") as LoroMap).toJSON();
        
        // --- 1. L'Anatomie Générique ---
        let result: any = {
            "Type": type, // Type ONLYOFFICE (ex: "Paragraph")
            "InternalId": internalId,
            ...props // On injecte toutes les propriétés visuelles interceptées
        };

        // --- 2. L'Anatomie Spécifique (Le "Mapping") ---
        
        // Texte
        if (type === "Run" || type === "Text") {
            const loroText = nodeData.get("text") as LoroText;
            result["Text"] = loroText ? loroText.toString() : "";
        }
        
        // Enfants (Récursivité)
        const children = treeNode.children();
        if (children.length > 0) {
            result["Elements"] = [];
            for (const child of children) {
                result["Elements"].push(this.buildJsonRecursive(child));
            }
        }

        // TODO: Mappings spécifiques (Tableaux, Images, SmartArts...)
        // Si type === "Table", restructurer result["Elements"] en tr/td
        
        return result;
    }

    // --- Réseau ---
    public exportSnapshot(): Uint8Array { return this.doc.exportSnapshot(); }
    public import(data: Uint8Array): void { this.doc.import(data); }
}
