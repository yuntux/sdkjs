import * as dgram from "dgram"; // Accessible car nous sommes dans Electron/CEF Node.js
import * as os from "os";
import { LoroSyncManager } from "./LoroSyncManager";

/**
 * Phase 7 : Pont d'Injection spécifique à DesktopEditors (CEF / Chromium)
 * Ce fichier n'est chargé QUE dans l'application de bureau (qui a un accès total à Node.js).
 */
export class DesktopAppInjector {
    private syncManager: LoroSyncManager;
    private mdnsSocketV4: dgram.Socket;
    private mdnsSocketV6: dgram.Socket;
    private readonly MDNS_PORT = 5353;
    private readonly MDNS_GROUP_V4 = "224.0.0.251"; // IP Multicast mDNS standard (IPv4)
    private readonly MDNS_GROUP_V6 = "ff02::fb";    // IP Multicast mDNS standard (IPv6)

    constructor(syncManager: LoroSyncManager) {
        this.syncManager = syncManager;
        
        console.log("🖥️ Environnement Desktop détecté. Activation des capacités embarquées...");
        this.setupMdnsDiscovery();
    }

    /**
     * Phase 6 : Implémentation mDNS (Auto-découverte P2P locale)
     * Permet à deux ordinateurs sur le même réseau WiFi sans routeur Internet de se trouver.
     */
    private setupMdnsDiscovery() {
        // --- Socket IPv4 ---
        this.mdnsSocketV4 = dgram.createSocket({ type: "udp4", reuseAddr: true });
        this.mdnsSocketV4.on("message", (msg, rinfo) => this.handleDiscoveryMessage(msg, rinfo));
        
        this.mdnsSocketV4.bind(this.MDNS_PORT, () => {
            try { this.mdnsSocketV4.addMembership(this.MDNS_GROUP_V4); } catch(e) { console.warn("Erreur Multicast IPv4:", e); }
        });

        // --- Socket IPv6 ---
        this.mdnsSocketV6 = dgram.createSocket({ type: "udp6", reuseAddr: true });
        this.mdnsSocketV6.on("message", (msg, rinfo) => this.handleDiscoveryMessage(msg, rinfo));
        
        this.mdnsSocketV6.bind(this.MDNS_PORT, () => {
            try { this.mdnsSocketV6.addMembership(this.MDNS_GROUP_V6); } catch(e) { console.warn("Erreur Multicast IPv6:", e); }
        });

        // Diffuser notre propre présence sur le réseau local
        setInterval(() => {
            const myIp = this.getLocalIp();
            const discoveryMsg = Buffer.from(`LORO_PEER_DISCOVERY:${myIp}`);
            
            // Broadcast sur les deux réseaux
            try { this.mdnsSocketV4.send(discoveryMsg, 0, discoveryMsg.length, this.MDNS_PORT, this.MDNS_GROUP_V4); } catch(e) {}
            try { this.mdnsSocketV6.send(discoveryMsg, 0, discoveryMsg.length, this.MDNS_PORT, this.MDNS_GROUP_V6); } catch(e) {}
        }, 5000); // Ping toutes les 5 secondes
    }

    private handleDiscoveryMessage(msg: Buffer, rinfo: dgram.RemoteInfo) {
        const strMsg = msg.toString();
        if (strMsg.startsWith("LORO_PEER_DISCOVERY")) {
            const peerIp = rinfo.address;
            console.log(`📡 Pair Loro détecté sur le réseau local à l'IP: ${peerIp}`);
            // Initialisation d'une connexion P2P directe via WebRTC ou TCP direct
            this.syncManager.initP2P(peerIp);
        }
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
