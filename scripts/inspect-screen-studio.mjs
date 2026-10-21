// Read-only local inspection; recovered files stay outside this project.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
const archive = process.argv[2] || '/Applications/Screen Studio.app/Contents/Resources/app.asar';
const output = path.resolve(process.argv[3] || '/private/tmp/screen-studio-reference');
fs.mkdirSync(output, { recursive: true });
const fd = fs.openSync(archive, 'r');
try {
  const prefix = Buffer.alloc(16);
  if (fs.readSync(fd, prefix, 0, 16, 0) !== 16) throw new Error('Invalid ASAR header');
  const size = prefix.readUInt32LE(12), base = 8 + prefix.readUInt32LE(4);
  if (size > 32 * 1024 * 1024 || size < 2 || base < 16 + size) throw new Error('Invalid ASAR header size');
  const header = Buffer.alloc(size);
  fs.readSync(fd, header, 0, size, 16);
  const tree = JSON.parse(header.toString('utf8'));
  const entries = tree.files?.dist?.files;
  if (!entries) throw new Error('No dist directory');
  const report = [];
  for (const [name, entry] of Object.entries(entries)) {
    if (!/^[\w.-]+\.(js|css)$/.test(name) || !entry.offset || entry.unpacked) continue;
    const offset = Number(entry.offset);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(entry.size) || entry.size > 20 * 1024 * 1024) throw new Error('Invalid ASAR entry');
    const data = Buffer.alloc(entry.size);
    if (fs.readSync(fd, data, 0, data.length, base + offset) !== data.length) throw new Error('Incomplete ASAR entry');
    fs.writeFileSync(path.join(output, name), data);
    const source = data.toString('utf8');
    const item = { name, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
    if (name.endsWith('.js')) {
      const parsed = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const strings = [];
      const result = ts.transform(parsed, [context => {
        const visit = node => {
          if (ts.isStringLiteral(node)) { strings.push(node.text); return ts.factory.createStringLiteral(node.text); }
          return ts.visitEachChild(node, visit, context);
        };
        return node => ts.visitNode(node, visit);
      }]);
      // Formatting and literal decoding do not recover original identifiers or remove obfuscation.
      if (strings.some(text => ['mouseMovementSpring','Background blur','springsManager'].includes(text))) {
        fs.writeFileSync(path.join(output, `${name}.readable.js`), ts.createPrinter().printFile(result.transformed[0]));
      }
      item.controls = [...new Set(strings.filter(text => text.length < 120 && /background|cursor|motion.?blur|spring|stiffness|damping/i.test(text)))];
      result.dispose();
    }
    report.push(item);
  }
  fs.writeFileSync(path.join(output, 'inventory.json'), JSON.stringify(report, null, 2));
  console.log(`${report.length} módulos extraídos para ${output}. Inventário: inventory.json`);
} finally { fs.closeSync(fd); }
