/**
 * Injector.ts
 * Ce script a pour but de "stubber" (remplacer) la couche réseau officielle d'ONLYOFFICE (DocsCoApi)
 * pour couper le lien avec le Document Server et rediriger les modifications vers notre couche Loro CRDT.
 * 
 * Il doit être chargé APRÈS l'initialisation de sdkjs.
 */

export function injectLoroSync() {
    console.log("🛠️ Injection de la couche Loro CRDT dans sdkjs...");

    if (!window.AscCommon || !window.AscCommon.CDocsCoApi) {
        console.warn("⚠️ AscCommon.CDocsCoApi non trouvé. L'éditeur est-il bien chargé ?");
        return;
    }

    // 1. Sauvegarde de l'API originale (au cas où on aurait besoin d'appeler certaines méthodes internes)
    const originalDocsCoApi = window.AscCommon.CDocsCoApi;

    // 2. Remplacement par notre Mock (Stub)
    window.AscCommon.CDocsCoApi = function(oDocument, oEditor) {
        console.log("✅ Loro DocsCoApi Stub initialisé ! Connexion au serveur ONLYOFFICE bloquée.");
        
        this.Document = oDocument;
        this.Editor = oEditor;
        
        // --- Méthodes réseau stubbées ---

        this.Connect = function() {
            console.log("🛑 Blocage de Connect() : pas de WebSocket vers le Document Server.");
            // On pourrait initier la connexion WebRTC/mDNS ici plus tard.
        };

        this.Disconnect = function() {
            console.log("🛑 Disconnect() appelé.");
        };

        this.askSaveChanges = function(callback) {
            console.log("Intercepté askSaveChanges()");
            if (callback) callback();
        };

        this.saveChanges = function(arrayChanges, deleteIndex, excelAdditionalInfo) {
            console.log("🚀 INTERCEPTION DES CHANGEMENTS LOCAUX :", arrayChanges);
            // Routage vers le dictionnaire Loro CRDT
            if ((window as any).LoroBridgeMapper) {
                (window as any).LoroBridgeMapper.applyLocalChangesToLoro(arrayChanges);
            }
        };
        
        this.sendCoAuthMessage = function(message) {
            console.log("Intercepté sendCoAuthMessage (Awareness, Verrous):", message);
        };
        
        // --- Méthodes d'Awareness (Curseurs et Sélections) ---
        this.SendMouse = function(x, y) {
            // Sera mappé sur le canal Awareness (non-persistant) de Loro
        };
        
        this.SendSelection = function(selectionData) {
            // Sera mappé sur le canal Awareness pour voir ce que l'autre surligne
        };

        // --- Le flux Retour (Réseau -> Local) ---
        // Attention : La réception ne se fait pas via une surcharge de méthode sortante,
        // mais en appelant manuellement this.Editor.ApplyChanges() quand Loro émet un event.
        
        // Stub de toutes les autres méthodes pour éviter les crashs de l'interface
        this.CheckConnection = function() { return true; };
        this.Destroy = function() {};
    };

    // On copie le prototype original pour ne pas casser l'héritage d'autres classes
    window.AscCommon.CDocsCoApi.prototype = originalDocsCoApi.prototype;

    console.log("✅ Injection réussie ! L'éditeur est maintenant isolé du réseau officiel.");
}
