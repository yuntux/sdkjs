import fs from 'fs';
import path from 'path';

/**
 * Générateur Exhaustif de Mapping OOXML pour Loro-Sync
 * 
 * Ce script parcourt le code source d'ONLYOFFICE (HistoryCommon.js) pour 
 * extraire les centaines de "codes magiques" bitwise (OT Types).
 * Il génère ensuite un dictionnaire TypeScript statique `src/GeneratedMapper.ts`
 * qui sera utilisé par le pont pour traduire automatiquement n'importe quelle action
 * OOXML en modification CRDT, assurant une exhaustivité à 100%.
 */

const HISTORY_FILE = '/home/ubuntu/sdkjs/common/HistoryCommon.js';
const OUTPUT_FILE = '/home/ubuntu/sdkjs/loro_sync/src/GeneratedMapper.ts';

function generate() {
    console.log("🚀 Démarrage de l'analyse exhaustive des codes ONLYOFFICE...");
    const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
    
    const types = new Map(); // Ex: 'historyitem_type_ParaRun' -> 1835008
    const actions = new Map(); // Ex: 1835009 -> 'ParaRun_AddItem'

    // 1. Extraire les "Types" de base (les Shifts bitwise)
    // Exemple: window['AscDFH'].historyitem_type_ParaRun = 28 << 16;
    const typeRegex = /window\['AscDFH'\]\.(historyitem_type_[a-zA-Z0-9_]+)\s*=\s*(\d+)\s*<<\s*16/g;
    let match;
    while ((match = typeRegex.exec(content)) !== null) {
        const name = match[1];
        const val = parseInt(match[2], 10) << 16;
        types.set(name, val);
    }

    // 2. Extraire les Actions spécifiques (Les OR bitwise)
    // Exemple: window['AscDFH'].historyitem_ParaRun_Bold = window['AscDFH'].historyitem_type_ParaRun | 3;
    const actionRegex = /window\['AscDFH'\]\.(historyitem_[a-zA-Z0-9_]+)\s*=\s*window\['AscDFH'\]\.(historyitem_type_[a-zA-Z0-9_]+)\s*\|\s*(\d+|0x[0-9A-Fa-f]+)/g;
    while ((match = actionRegex.exec(content)) !== null) {
        const actionName = match[1].replace('historyitem_', ''); // Ex: ParaRun_Bold
        const baseTypeName = match[2];
        const addVal = parseInt(match[3]);

        if (types.has(baseTypeName)) {
            const finalCode = types.get(baseTypeName) | addVal;
            actions.set(finalCode, actionName);
        }
    }

    console.log(`✅ ${types.size} Classes de base trouvées.`);
    console.log(`✅ ${actions.size} Actions spécifiques (Codes Magiques) mappées.`);

    // 3. Générer le fichier TypeScript
    let tsContent = `// Fichier généré automatiquement par generate_mapper.js\n`;
    tsContent += `// Ne pas éditer manuellement.\n\n`;
    
    tsContent += `export const OoxmlActionDictionary: Record<number, string> = {\n`;
    for (const [code, name] of actions.entries()) {
        tsContent += `    ${code}: "${name}",\n`;
    }
    tsContent += `};\n\n`;

    tsContent += `/**
 * Tente d'appliquer une propriété générique basée sur le dictionnaire exhaustif.
 * Ex: Convertit l'ID binaire de "historyitem_Paragraph_Align" en un Loro.setNodeProperty(id, "Align", val)
 */
export function applyGenericMapping(change: any, adapter: any): boolean {
    const actionName = OoxmlActionDictionary[change.Type];
    if (!actionName) return false;

    // Parsing générique: si l'action est "Classe_Propriété" (ex: Paragraph_Align)
    const parts = actionName.split('_');
    if (parts.length >= 2 && change.Id) {
        const className = parts[0]; // Paragraph
        const propName = parts.slice(1).join('_'); // Align

        // Si c'est une création
        if (propName === 'AddItem' || propName === 'AddSlide' || propName === 'AddRow') {
             adapter.registerNode(change.Id, className);
             return true;
        }
        
        // Si c'est une propriété simple (et qu'on a une Value dans l'event)
        if (change.Value !== undefined) {
             adapter.setNodeProperty(change.Id, propName, change.Value);
             return true;
        }

        // Si les valeurs sont dans Props (Word TextPr)
        if (change.Props && Object.keys(change.Props).length > 0) {
             for (const [k, v] of Object.entries(change.Props)) {
                  adapter.setNodeProperty(change.Id, k, v);
             }
             return true;
        }
    }
    return false;
}
`;

    fs.writeFileSync(OUTPUT_FILE, tsContent, 'utf-8');
    console.log(`🎉 Fichier généré avec succès dans : ${OUTPUT_FILE}`);
}

generate();
