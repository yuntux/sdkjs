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

    // --- RÉSEAU ET SYNCHRONISATION ---
    // Le "Cold Start" complet (Document complet) n'est plus géré par Loro mais par le chargement
    // natif du fichier .docx fourni par Seafile. Loro se contente d'importer l'historique P2P
    // de la session en cours.
    public exportSnapshot(): Uint8Array { return this.doc.exportSnapshot(); }
    public import(data: Uint8Array): void { this.doc.import(data); }
}
