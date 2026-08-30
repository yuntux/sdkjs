import { Loro, LoroList, LoroMap, LoroText } from "loro-crdt";

/**
 * LoroDocumentAdapter - Approche "Industrielle" (Flat Node Registry)
 * 
 * Au lieu de modéliser manuellement chaque type de bloc OOXML (Paragraphe, Table, Run),
 * nous créons un miroir générique du DOM d'ONLYOFFICE basé sur les InternalIds uniques.
 */
export class LoroDocumentAdapter {
    private doc: Loro;
    // Registre plat contenant tous les nœuds du document
    // Clé: InternalId (généré par sdkjs) -> Valeur: LoroMap modélisant l'élément
    private nodes: LoroMap;
    
    // Nœud racine du document (ex: le body principal)
    private rootId: string = "root";

    constructor(existingDoc?: Loro) {
        this.doc = existingDoc || new Loro();
        this.nodes = this.doc.getMap("nodes");
        
        // Initialisation de la racine si c'est un nouveau document
        if (!this.nodes.has(this.rootId)) {
            const rootNode = new LoroMap();
            rootNode.set("type", "document_body");
            rootNode.setContainer("children", new LoroList());
            this.nodes.setContainer(this.rootId, rootNode);
        }
    }

    public getDoc(): Loro {
        return this.doc;
    }

    /**
     * Crée ou met à jour un nœud générique.
     * @param internalId L'ID unique généré par sdkjs (ex: oParagraph.InternalId)
     * @param nodeType Le type du nœud (ex: "Paragraph", "Run", "Table")
     */
    public registerNode(internalId: string, nodeType: string): LoroMap {
        if (!this.nodes.has(internalId)) {
            const nodeMap = new LoroMap();
            nodeMap.set("type", nodeType);
            
            // Propriétés du nœud (formatage, marges, etc.)
            nodeMap.setContainer("props", new LoroMap());
            
            // Si le nœud peut contenir d'autres nœuds, on lui prépare une liste d'enfants
            nodeMap.setContainer("children", new LoroList());
            
            // S'il s'agit d'un nœud textuel (CRun), on prépare son buffer texte
            if (nodeType === "Run" || nodeType === "Text") {
                nodeMap.setContainer("text", new LoroText());
            }

            this.nodes.setContainer(internalId, nodeMap);
        }
        return this.nodes.get(internalId) as LoroMap;
    }

    /**
     * Supprime un nœud du registre.
     */
    public unregisterNode(internalId: string): void {
        this.nodes.delete(internalId);
    }

    /**
     * Met à jour une propriété (Gras, Italique, Taille...) sur un nœud.
     * Automatiquement "future-proof" peu importe les nouveautés de sdkjs.
     */
    public setNodeProperty(internalId: string, propKey: string, propValue: any): void {
        const node = this.nodes.get(internalId) as LoroMap;
        if (!node) return;
        
        const props = node.get("props") as LoroMap;
        props.set(propKey, propValue);
    }

    /**
     * Insère un enfant dans l'arborescence.
     */
    public insertChild(parentId: string, childId: string, index: number): void {
        const parent = this.nodes.get(parentId) as LoroMap;
        if (!parent) return;

        const children = parent.get("children") as LoroList;
        children.insert(index, childId);
    }

    /**
     * Retire un enfant de l'arborescence sans le supprimer du registre.
     */
    public removeChild(parentId: string, index: number): void {
        const parent = this.nodes.get(parentId) as LoroMap;
        if (!parent) return;

        const children = parent.get("children") as LoroList;
        children.delete(index, 1);
    }

    /**
     * Insère du texte dans un conteneur textuel (ex: CRun).
     */
    public insertText(internalId: string, offset: number, text: string): void {
        const node = this.nodes.get(internalId) as LoroMap;
        if (!node) return;

        const loroText = node.get("text") as LoroText;
        if (loroText) {
            loroText.insert(offset, text);
        }
    }

    /**
     * Supprime du texte dans un conteneur textuel.
     */
    public deleteText(internalId: string, offset: number, length: number): void {
        const node = this.nodes.get(internalId) as LoroMap;
        if (!node) return;

        const loroText = node.get("text") as LoroText;
        if (loroText) {
            loroText.delete(offset, length);
        }
    }

    // --- Méthodes de synchronisation réseau ---

    public exportSnapshot(): Uint8Array {
        return this.doc.exportSnapshot();
    }

    public import(data: Uint8Array): void {
        this.doc.import(data);
    }
}
