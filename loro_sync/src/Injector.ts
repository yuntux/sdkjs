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
            // C'est ICI que nous traduirons les 'arrayChanges' d'ONLYOFFICE (OT)
            // en opérations Loro (CRDT) avant de les diffuser en P2P !
        };
        
        this.sendCoAuthMessage = function(message) {
            console.log("Intercepté sendCoAuthMessage:", message);
        };
        
        // Stub de toutes les autres méthodes pour éviter les crashs
        this.CheckConnection = function() { return true; };
        this.SendMouse = function() {};
        this.Destroy = function() {};
    };

    // On copie le prototype original pour ne pas casser l'héritage d'autres classes
    window.AscCommon.CDocsCoApi.prototype = originalDocsCoApi.prototype;

    console.log("✅ Injection réussie ! L'éditeur est maintenant isolé du réseau officiel.");
}
