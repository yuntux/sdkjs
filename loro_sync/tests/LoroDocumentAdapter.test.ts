import { describe, it, expect } from "vitest";
import { LoroDocumentAdapter } from "../src/LoroDocumentAdapter";

describe("LoroDocumentAdapter", () => {
    it("devrait s'initialiser avec un paragraphe vide par défaut", () => {
        const adapter = new LoroDocumentAdapter();
        expect(adapter.getParagraphText(0)).toBe("");
    });

    it("devrait insérer du texte dans le paragraphe par défaut", () => {
        const adapter = new LoroDocumentAdapter();
        adapter.insertText(0, 0, "Bonjour");
        adapter.insertText(0, 7, " le monde !");
        
        expect(adapter.getParagraphText(0)).toBe("Bonjour le monde !");
    });

    it("devrait gérer l'ajout et la suppression de paragraphes", () => {
        const adapter = new LoroDocumentAdapter();
        adapter.insertText(0, 0, "Paragraphe 1");
        
        adapter.addParagraph(1);
        adapter.insertText(1, 0, "Paragraphe 2");
        
        expect(adapter.getParagraphText(0)).toBe("Paragraphe 1");
        expect(adapter.getParagraphText(1)).toBe("Paragraphe 2");
        
        adapter.removeParagraph(0);
        expect(adapter.getParagraphText(0)).toBe("Paragraphe 2");
    });

    it("devrait synchroniser et converger deux documents (simulation P2P)", () => {
        // Client A
        const clientA = new LoroDocumentAdapter();
        clientA.insertText(0, 0, "Bonjour");

        // Client B (initialise une copie vide)
        const clientB = new LoroDocumentAdapter();
        
        // Client A envoie son état initial au Client B
        const snapshotA = clientA.exportSnapshot();
        clientB.import(snapshotA);
        expect(clientB.getParagraphText(0)).toBe("Bonjour");

        // Modifications concurrentes (hors-ligne)
        clientA.insertText(0, 7, " Alice");
        clientB.insertText(0, 7, " Bob");

        // Synchronisation croisée via calcul des vecteurs de version
        const deltaA = clientA.getDoc().exportFrom(clientB.getDoc().version());
        const deltaB = clientB.getDoc().exportFrom(clientA.getDoc().version());

        clientA.import(deltaB);
        clientB.import(deltaA);

        // Les deux CRDT doivent converger vers le même état, même si l'ordre exact dépend du HLC
        expect(clientA.getParagraphText(0)).toEqual(clientB.getParagraphText(0));
    });
});
