import { Loro, LoroList, LoroMap, LoroText } from "loro-crdt";

/**
 * Adaptateur qui encapsule un document Loro (CRDT) pour représenter la structure d'un document OOXML.
 * Il modélise le document comme une liste (body) contenant des blocs (Map),
 * où chaque paragraphe (Map) possède un contenu textuel (Text).
 */
export class LoroDocumentAdapter {
    private doc: Loro;
    private body: LoroList;

    constructor(existingDoc?: Loro) {
        this.doc = existingDoc || new Loro();
        this.body = this.doc.getList("body");
        
        // Initialisation par défaut si le document est vide
        if (this.body.length === 0) {
            this.addParagraph(0);
        }
    }

    /**
     * Retourne l'instance brute de Loro (utile pour la synchronisation réseau).
     */
    public getDoc(): Loro {
        return this.doc;
    }

    /**
     * Ajoute un nouveau paragraphe à un index donné dans le document.
     */
    public addParagraph(index: number): void {
        // Dans Loro v0.16+, on instancie directement le conteneur
        const paraMap = this.body.insertContainer(index, new LoroMap());
        paraMap.set("type", "paragraph");
        paraMap.set("style", "Normal");
        
        // On attache un conteneur "Text" pour le contenu du paragraphe
        paraMap.setContainer("content", new LoroText());
    }

    /**
     * Supprime un paragraphe entier.
     */
    public removeParagraph(index: number): void {
        this.body.delete(index, 1);
    }

    /**
     * Insère du texte à une position précise dans un paragraphe existant.
     */
    public insertText(paraIndex: number, offset: number, text: string): void {
        const paraMap = this.getParagraphMap(paraIndex);
        const content = paraMap.get("content") as LoroText;
        content.insert(offset, text);
    }

    /**
     * Supprime du texte dans un paragraphe existant.
     */
    public deleteText(paraIndex: number, offset: number, length: number): void {
        const paraMap = this.getParagraphMap(paraIndex);
        const content = paraMap.get("content") as LoroText;
        content.delete(offset, length);
    }

    /**
     * Lit le contenu textuel complet d'un paragraphe.
     */
    public getParagraphText(paraIndex: number): string {
        const paraMap = this.getParagraphMap(paraIndex);
        const content = paraMap.get("content") as LoroText;
        return content.toString();
    }

    private getParagraphMap(index: number): LoroMap {
        const paraMap = this.body.get(index) as LoroMap;
        if (!paraMap || paraMap.get("type") !== "paragraph") {
            throw new Error(`Le bloc à l'index ${index} n'est pas un paragraphe valide.`);
        }
        return paraMap;
    }

    // --- Méthodes de synchronisation réseau ---

    public exportSnapshot(): Uint8Array {
        return this.doc.exportSnapshot();
    }

    public import(data: Uint8Array): void {
        this.doc.import(data);
    }
}
