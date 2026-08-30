// src/lazyImageLoader.ts - Patch pour le runtime sdkjs

interface LazyMediaDescriptor {
    mediaId: string;
    url: string;
    width: number;
    height: number;
    bitmap: ImageBitmap | null;
    isLoading: boolean;
}

export class LazyImageManager {
    private mediaCache = new Map<string, LazyMediaDescriptor>();
    private maxCachedBitmaps = 50; // Limite stricte pour préserver la RAM GPU

    /**
     * Enregistre les métadonnées de l'image sans la charger en mémoire
     */
    public registerMedia(mediaId: string, remoteUrl: string, width: number, height: number) {
        if (!this.mediaCache.has(mediaId)) {
            this.mediaCache.set(mediaId, {
                mediaId,
                url: remoteUrl,
                width,
                height,
                bitmap: null,
                isLoading: false,
            });
        }
    }

    /**
     * Appelé par la boucle de rendu Canvas de sdkjs
     * @param ctx Contexte de rendu 2D du Canvas
     * @param viewportBounds Coordonnées de la zone affichée [top, left, bottom, right]
     */
    public requestRender(
        ctx: CanvasRenderingContext2D,
        mediaId: string,
        targetX: number,
        targetY: number,
        targetW: number,
        targetH: number,
        viewportBounds: { top: number; left: number; bottom: number; right: number },
        onLoadedCallback: () => void
    ) {
        const item = this.mediaCache.get(mediaId);
        if (!item) return;

        // 1. Test de visibilité (Frustum Culling 2D)
        const isVisible = !(
            targetX + targetW < viewportBounds.left ||
            targetX > viewportBounds.right ||
            targetY + targetH < viewportBounds.top ||
            targetY > viewportBounds.bottom
        );

        if (!isVisible) {
            // Si l'image n'est plus visible et que le cache déborde, on libère le buffer GPU
            if (item.bitmap && this.mediaCache.size > this.maxCachedBitmaps) {
                item.bitmap.close(); // Libère ImageBitmap
                item.bitmap = null;
            }
            return;
        }

        // 2. Si l'image est prête en mémoire GPU, on la dessine
        if (item.bitmap) {
            ctx.drawImage(item.bitmap, targetX, targetY, targetW, targetH);
            return;
        }

        // 3. Rendu du placeholder basse résolution ou squelette
        ctx.save();
        ctx.fillStyle = "#f0f0f0";
        ctx.fillRect(targetX, targetY, targetW, targetH);
        ctx.strokeStyle = "#cccccc";
        ctx.strokeRect(targetX, targetY, targetW, targetH);
        ctx.restore();

        // 4. Déclenchement du fetch différé si non déjà en cours
        if (!item.isLoading) {
            item.isLoading = true;
            this.fetchAndDecode(item, onLoadedCallback);
        }
    }

    private async fetchAndDecode(item: LazyMediaDescriptor, callback: () => void) {
        try {
            const response = await fetch(item.url);
            const blob = await response.blob();
            
            // createImageBitmap décode l'image hors du thread principal UI
            const bitmap = await createImageBitmap(blob);
            item.bitmap = bitmap;
            item.isLoading = false;

            // Déclenche un rafraîchissement ciblé du Canvas
            callback();
        } catch (err) {
            console.error(`Échec du chargement lazy de l'image ${item.mediaId}`, err);
            item.isLoading = false;
        }
    }
}

// L'injection globale pour l'interception dans sdkjs
if (typeof window !== "undefined") {
    (window as any).LoroOfficeLazyImageManager = new LazyImageManager();

    // Note : Le hook sur window.AscFormat.CImageDrawing.prototype.Draw
    // devra être exécuté après le chargement de sdkjs (dans Injector.ts ou un hook dédié).
}
