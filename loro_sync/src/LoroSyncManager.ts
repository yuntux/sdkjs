import { LoroDoc, UndoManager } from "loro-crdt";

/**
 * Gestionnaire Réseau (Phase 4 & 5)
 * Gère la diffusion (Tx) et la réception (Rx) des deltas Loro,
 * ainsi que l'interconnexion avec le relais Rust et le P2P WebRTC.
 */
export class LoroSyncManager {
    private doc: LoroDoc;
    private ws: WebSocket | null = null;
    private peerConnections: Map<string, any> = new Map(); // RTC DataChannels
    public undoManager: UndoManager; // Phase 5 : Time-Travel

    constructor(doc: LoroDoc) {
        this.doc = doc;
        this.undoManager = new UndoManager(this.doc); // Isolation causale des Undo/Redo
        
        // Souscription aux changements locaux (CRDT) pour diffusion réseau
        this.doc.subscribe(event => {
            if (event.local) {
                const delta = this.doc.exportFrom(); // Delta binaire optimisé
                this.broadcastToPeers(delta);
                this.sendToRustRelay(delta);
            }
        });
    }

    /**
     * Phase 4 : Routeur Rust (Client WebSocket)
     */
    public connectToRelay(url: string, jwtToken: string) {
        this.ws = new WebSocket(`${url}?token=${jwtToken}`);
        
        this.ws.onmessage = async (event) => {
            if (event.data instanceof Blob) {
                const buffer = new Uint8Array(await event.data.arrayBuffer());
                
                // 1. Verrouiller le pont local (MutationGuard)
                if ((window as any).LoroBridgeMapper) {
                    (window as any).LoroBridgeMapper.lock();
                }
                
                // 2. Importer le delta mathématique
                this.doc.import(buffer);
                
                // 3. (TODO) Traduire le delta Loro entrant vers ONLYOFFICE
                // this.translateLoroToOnlyOffice(buffer);
                
                // 4. Déverrouiller le pont
                if ((window as any).LoroBridgeMapper) {
                    (window as any).LoroBridgeMapper.unlock();
                }
            }
        };
    }

    private sendToRustRelay(delta: Uint8Array) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(delta);
        }
    }

    /**
     * Phase 5 : WebRTC P2P (Mode Local / Avion)
     */
    public initP2P(peerId: string) {
        console.log(`[P2P] Initialisation WebRTC pour le pair : ${peerId}`);
        // Logique de signaling (mDNS ou via le relais Rust)
        // Création des RTCPeerConnection et RTCDataChannel
    }

    private broadcastToPeers(delta: Uint8Array) {
        // Envoi binaire pur sur le réseau P2P local
        this.peerConnections.forEach(pc => {
            if (pc.readyState === "open") {
                pc.send(delta);
            }
        });
    }

    /**
     * Phase 4 : Client-Side Callback (Sauvegarde vers Seafile)
     * Remplacera le mécanisme de sauvegarde côté serveur du DocumentServer officiel.
     */
    public async saveToSeafile(callbackUrl: string, jwtToken: string) {
        console.log("💾 Déclenchement du Client-Side Callback vers Seafile...");
        
        // On exporte l'état complet du document Loro (le snapshot CRDT)
        const snapshot = this.doc.exportSnapshot();
        
        const formData = new FormData();
        formData.append("file", new Blob([snapshot]), "document.loro");

        try {
            const response = await fetch(`${callbackUrl}?token=${jwtToken}`, {
                method: "POST",
                body: formData
            });
            if (response.ok) {
                console.log("✅ Sauvegarde Seafile réussie (Snapshot CRDT poussé) !");
            } else {
                console.error("❌ Échec de la sauvegarde Seafile :", response.statusText);
            }
        } catch (e) {
            console.error("❌ Erreur réseau lors de la sauvegarde :", e);
        }
    }

    /**
     * Phase 4 : Interception et fusion de l'historique Seafile
     * Permet de restaurer les anciennes versions via un panneau latéral natif
     */
    public async fetchSeafileHistory(historyApiUrl: string) {
        console.log(`🕒 Récupération de l'historique Seafile depuis ${historyApiUrl}...`);
        // Logique de peuplement du bouton natif ONLYOFFICE (Section 19.3)
    }

    // --- PHASE 5 : AWARENESS & TIME-TRAVEL ---

    public sendCursor(x: number, y: number) {
        // Envoi au Peer via RTC DataChannel (Éphémère, ne pollue pas le CRDT)
        const cursorEvent = JSON.stringify({ type: 'cursor', peer: 'me', x, y });
        // this.broadcastToPeers(new TextEncoder().encode(cursorEvent));
    }

    public acquireSoftLock(nodeId: string) {
        console.log(`🔒 Acquisition Soft-Lock émulé sur : ${nodeId}`);
        const lockEvent = JSON.stringify({ type: 'soft_lock', peer: 'me', nodeId });
        // this.broadcastToPeers(new TextEncoder().encode(lockEvent));
    }

    public undo() {
        console.log("⏪ Time-Travel : Undo causal Loro exécuté (Ignore les frappes distantes)");
        if (this.undoManager.canUndo()) {
            this.undoManager.undo();
            this.doc.commit();
        }
    }

    public redo() {
        console.log("⏩ Time-Travel : Redo causal Loro exécuté");
        if (this.undoManager.canRedo()) {
            this.undoManager.redo();
            this.doc.commit();
        }
    }

    // --- PHASE 7 : BASCULE ASYNCHRONE (MODE AVION) ---
    
    public isOfflineMode: boolean = false;

    public toggleAirplaneMode(isOffline: boolean) {
        this.isOfflineMode = isOffline;
        if (isOffline) {
            console.log("✈️ Bascule en Mode Avion. Les deltas CRDT s'accumulent en local.");
            if (this.ws) {
                this.ws.close();
            }
        } else {
            console.log("🌍 Retour en ligne. Re-synchronisation mathématique Loro en cours...");
            this.connectToRelay('ws://localhost:3000/room/crdt_test_1', 'fake_jwt');
            // Le CRDT Loro se synchronisera automatiquement lors du handshake
        }
    }

    /**
     * Phase 5.5 : State Transfer P2P Natif (Le Transfert Jumeau Atomique)
     * Fonction appelée lorsque le routeur désigne ce navigateur comme "Parrain" pour un nouvel arrivant.
     */
    public async handleStateTransferRequest(editor: any, requestingPeerId: string) {
        console.log(`[P2P] Demande de State Transfer reçue de ${requestingPeerId}. Génération en cours...`);
        
        try {
            // 1. Atomicité : Geler le CRDT Loro exactement au moment où on lance la demande à ONLYOFFICE
            const loroSnapshot = this.doc.exportSnapshot();
            
            // 2. Génération : Demande asynchrone (WebWorker) au moteur C++ de générer le binaire .docx
            // (La méthode exacte d'export binaire varie selon l'API interne sdkjs/builder)
            const docxBlob = await editor.downloadAs("docx"); 

            console.log(`[P2P] Jumeaux générés (Loro: ${loroSnapshot.length} bytes, DOCX: ${docxBlob.size} bytes). Envoi au routeur.`);

            // 3. Expédition : On envoie les jumeaux atomiques au nouveau venu
            const transferPayload = JSON.stringify({
                type: "STATE_TRANSFER_RESPONSE",
                targetPeerId: requestingPeerId,
                docx: docxBlob, // Dans une implémentation réelle WebSockets, on enverrait un Blob multiparts ou un ArrayBuffer combiné
                loro: Array.from(loroSnapshot)
            });

            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(transferPayload);
            }
        } catch (e) {
            console.error("❌ Échec de la génération des jumeaux atomiques :", e);
        }
    }
}
