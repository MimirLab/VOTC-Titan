const fs = require('fs');
const path = require('path');
const { transpileFile } = require("ts-to-jsdoc");
const ts = require('typescript');

const folderPath = path.join(__dirname, '..', 'src', 'shared', 'gameData');
const gameDataCode = fs.readFileSync(path.join(folderPath, 'GameData.ts'), 'utf8');
const characterCode = fs.readFileSync(path.join(folderPath, 'Character.ts'), 'utf8');

let output = transpileFile({code: gameDataCode}) + transpileFile({code: characterCode})

//remove imports
let lines = output.split("\n");
for(let i=0;i<lines.length;i++){
    if(lines[i].includes('import')){
        if (lines[i].includes('/**') && !lines[i].includes('*/')) lines[i] = '/**';
        else { lines.splice(i, 1); i--; }
    }
}
output = lines.join('\n');

// Interfaces are erased by the transpiler. Keep their public fields available to
// editors of userdata scripts, including the optional verified capture metadata.
for (const filename of ['CultureSnapshot.ts', 'FaithSnapshot.ts', 'GoaSnapshot.ts', 'gameDate.ts']) {
    const source = ts.createSourceFile(filename, fs.readFileSync(path.join(folderPath, filename), 'utf8'), ts.ScriptTarget.Latest, true);
    for (const declaration of source.statements.filter(ts.isInterfaceDeclaration)) {
        output += '\n/**\n * @typedef {Object} ' + declaration.name.text + '\n';
        for (const field of declaration.members.filter(ts.isPropertySignature)) {
            output += ' * @property {' + (field.type?.getText(source) ?? '*') + '} ' +
                (field.questionToken ? '[' + field.name.getText(source) + ']' : field.name.getText(source)) + '\n';
        }
        output += ' */\n';
    }
}

// ts-to-jsdoc emits class fields without their TypeScript annotations. Preserve
// those types in JSDoc and produce valid CommonJS rather than residual TS/exports.
const propertyTypes = new Map();
for (const code of [gameDataCode, characterCode]) {
    const source = ts.createSourceFile('source.ts', code, ts.ScriptTarget.Latest, true);
    for (const declaration of source.statements.filter(ts.isClassDeclaration)) {
        for (const field of declaration.members.filter(ts.isPropertyDeclaration)) {
            if (field.type) propertyTypes.set(declaration.name.text + '.' + field.name.getText(source), field.type.getText(source) + (field.questionToken ? ' | undefined' : ''));
        }
    }
}
output = ts.transpileModule(output, {
    fileName: 'gamedata_typedefs.js',
    compilerOptions: { allowJs: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    transformers: { before: [context => source => {
        function visit(node) {
            if (ts.isClassDeclaration(node)) {
                for (const field of node.members.filter(ts.isPropertyDeclaration)) {
                    const type = propertyTypes.get(node.name.text + '.' + field.name.getText(source));
                    if (type) ts.addSyntheticLeadingComment(field, ts.SyntaxKind.MultiLineCommentTrivia, '* @type {' + type + '} ', true);
                }
            }
            return ts.visitEachChild(node, visit, context);
        }
        return ts.visitNode(source, visit);
    }] }
}).outputText;

fs.writeFileSync(path.join(__dirname, '..', 'default_userdata', 'scripts', 'gamedata_typedefs.js'), output);

