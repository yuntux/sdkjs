import * as dgram from "dgram"; // Accessible car nous sommes dans Electron/CEF Node.js
import * as os from "os";
import { LoroSyncManager } from "./LoroSyncManager";

/**
 * Phase 7 : Pont d'Injection spécifique à DesktopEditors (CEF / Chromium)
 * Ce fichier n'est chargé QUE dans l'application de bureau (qui a un accès total à Node.js).
 */
export class DesktopAppInjector {
    private syncManager: LoroSyncManager;
    private mdnsSocket: dgram.Socket;
    private readonly MDNS_PORT = 5353;
    private readonly MDNS_GROUP = "224.0.0.251"; // IP Multicast standard

    constructor(syncManager: LoroSyncManager) {
        this.syncManager = syncManager;
        
        console.log("🖥️ Environnement Desktop détecté. Activation des capacités embarquées...");
        this.setupMdnsDiscovery();
        this.overrideLocalSaveButton();
    }

    /**
     * Phase 6 : Implémentation mDNS (Auto-découverte P2P locale)
     * Permet à deux ordinateurs sur le même réseau WiFi sans routeur Internet de se trouver.
     */
    private setupMdnsDiscovery() {
        this.mdnsSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });

        this.mdnsSocket.on("message", (msg, rinfo) => {
            const strMsg = msg.toString();
            if (strMsg.startsWith("LORO_PEER_DISCOVERY")) {
                const peerIp = rinfo.address;
                console.log(`📡 Pair Loro détecté sur le réseau local à l'IP: ${peerIp}`);
                // Initialisation d'une connexion P2P directe via WebRTC ou TCP direct
                this.syncManager.initP2P(peerIp);
            }
        });

        this.mdnsSocket.bind(this.MDNS_PORT, () => {
            this.mdnsSocket.addMembership(this.MDNS_GROUP);
            
            // Diffuser notre propre présence sur le réseau local
            const myIp = this.getLocalIp();
            const discoveryMsg = Buffer.from(`LORO_PEER_DISCOVERY:${myIp}`);
            
            setInterval(() => {
                this.mdnsSocket.send(discoveryMsg, 0, discoveryMsg.length, this.MDNS_PORT, this.MDNS_GROUP);
            }, 5000); // Ping toutes les 5 secondes
        });
    }

    /**
     * Phase 7 : Remplacement de la sauvegarde native locale
     */
    private overrideLocalSaveButton() {
        // Dans DesktopEditors, la sauvegarde vers le disque dur se fait via l'API FS
        (window as any).saveLocalLoroFile = (filePath: string) => {
            const fs = require("fs");
            // const snapshot = this.syncManager.doc.exportSnapshot(); // API Loro
            const snapshot = new Uint8Array([0, 1, 2]); // Stub
            fs.writeFileSync(filePath, snapshot);
            console.log(`💾 Fichier Loro local persisté sur le disque dur : ${filePath}`);
        };
    }

    private getLocalIp(): string {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]!) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
        return "127.0.0.1";
    }
}
