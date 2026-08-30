import { test, expect } from '@playwright/test';

test.describe('Loro-ONLYOFFICE : Tests E2E de Convergence CRDT', () => {
    test('Alice et Bob tapent simultanément (Chaos Testing) et convergent mathématiquement', async ({ browser }) => {
        // 1. Ouvrir deux navigateurs isolés
        const contextA = await browser.newContext();
        const contextB = await browser.newContext();
        
        const pageA = await contextA.newPage();
        const pageB = await contextB.newPage();

        // 2. Rejoindre le même document via le relais Rust
        const docUrl = 'http://localhost:8080/editor?doc_id=crdt_test_1';
        await Promise.all([
            pageA.goto(docUrl),
            pageB.goto(docUrl)
        ]);

        // 3. Attendre l'initialisation de l'iframe ONLYOFFICE
        const frameA = pageA.frameLocator('#iframeEditor');
        const frameB = pageB.frameLocator('#iframeEditor');
        
        // Sélecteur hypothétique pour s'assurer que le moteur de rendu a fini le Cold Start
        await expect(frameA.locator('.document-editor-ready')).toBeVisible({ timeout: 15000 });
        await expect(frameB.locator('.document-editor-ready')).toBeVisible({ timeout: 15000 });

        const canvasA = frameA.locator('#id-viewer-canvas');
        const canvasB = frameB.locator('#id-viewer-canvas');

        // 4. Frappes simultanées asynchrones
        // Alice et Bob écrivent exactement en même temps sans verrou global
        const aliceTypes = canvasA.pressSequentially('Hello ', { delay: 30 });
        const bobTypes = canvasB.pressSequentially('World!', { delay: 40 });

        await Promise.all([aliceTypes, bobTypes]);

        // 5. Attente de la diffusion réseau (debounce de LoroSyncManager + latence WS)
        await pageA.waitForTimeout(1000);

        // 6. Validation de la convergence mathématique du registre
        // Plutôt que d'extraire le texte du Canvas (qui est dessiné en pixel), 
        // on sonde directement la vérité terrain : le Snapshot Loro du navigateur.
        const snapshotA = await pageA.evaluate(() => {
            return Array.from((window as any).LoroSyncManagerInstance.doc.exportSnapshot());
        });
        
        const snapshotB = await pageB.evaluate(() => {
            return Array.from((window as any).LoroSyncManagerInstance.doc.exportSnapshot());
        });

        // VÉRITABLE PREUVE DE CONVERGENCE :
        // Les deux tableaux d'octets binaire (snapshots) doivent être strictement identiques
        // malgré l'asynchronisme total des opérations.
        expect(snapshotA).toEqual(snapshotB);
        
        // (Optionnel) Vérifier que le texte généré final contient bien les deux mots fusionnés.
        const exportedJsonA = await pageA.evaluate(() => {
            return (window as any).LoroSyncManagerInstance.doc.toJSON();
        });
        const finalString = JSON.stringify(exportedJsonA);
        expect(finalString).toContain('Hello');
        expect(finalString).toContain('World!');
    });
});
