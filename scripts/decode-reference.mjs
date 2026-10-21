// Restricted static decoder: never evaluates or imports extracted application code.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root = process.argv[2] || '/private/tmp/screen-studio-reference';
function decode(name) {
  const source = ts.createSourceFile(name, fs.readFileSync(path.join(root,name),'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const nodes=[]; const walk=n=>{nodes.push(n);ts.forEachChild(n,walk);};walk(source);
  const array=nodes.filter(ts.isArrayLiteralExpression).filter(n=>n.elements.length>0&&n.elements.every(ts.isStringLiteral)).sort((a,b)=>b.elements.length-a.elements.length)[0];
  if(!array) throw new Error(`No plain string table: ${name}`);
  const table=array.elements.map(n=>n.text);
  const provider=nodes.find(n=>ts.isFunctionDeclaration(n)&&n.pos<=array.pos&&n.end>=array.end);
  const decoder=nodes.find(n=>ts.isFunctionDeclaration(n)&&n!==provider&&n.body&&n.body.getText(source).includes(`${provider.name.text}()`)&&n.parameters.length>=1);
  if(!decoder) throw new Error(`No simple decoder: ${name}`);
  const subtract=nodes.find(n=>ts.isBinaryExpression(n)&&n.pos>decoder.pos&&n.end<decoder.end&&n.operatorToken.kind===ts.SyntaxKind.MinusToken&&ts.isIdentifier(n.left)&&n.left.text===decoder.parameters[0].name.getText(source)&&ts.isNumericLiteral(n.right));
  if(!subtract) throw new Error(`No decoder offset: ${name}`);
  const offset=Number(subtract.right.text), aliases=new Set([decoder.name.text]);
  for(let changed=true;changed;) {changed=false;for(const n of nodes) if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.initializer&&ts.isIdentifier(n.initializer)&&aliases.has(n.initializer.text)&&!aliases.has(n.name.text)){aliases.add(n.name.text);changed=true;}}
  const checksum=nodes.find(n=>ts.isVariableDeclaration(n)&&n.initializer&&n.initializer.getText(source).includes('parseInt('));
  const rotate=nodes.find(n=>ts.isCallExpression(n)&&n.arguments[0]?.getText(source)===provider.name.text&&n.arguments.length===2);
  if(!checksum||!rotate||!ts.isNumericLiteral(rotate.arguments[1])) throw new Error(`Unsupported rotation: ${name}`);
  const target=Number(rotate.arguments[1].text);
  function read(n) {
    if(ts.isParenthesizedExpression(n))return read(n.expression);
    if(ts.isNumericLiteral(n))return Number(n.text);
    if(ts.isPrefixUnaryExpression(n)){const v=read(n.operand);if(n.operator===ts.SyntaxKind.MinusToken)return -v;if(n.operator===ts.SyntaxKind.PlusToken)return +v;}
    if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)) {
      if(aliases.has(n.expression.text))return table[read(n.arguments[0])-offset];
      if(n.expression.text==='parseInt')return parseInt(read(n.arguments[0]),10);
    }
    if(ts.isBinaryExpression(n)) {
      const a=read(n.left),b=read(n.right);
      switch(n.operatorToken.kind){case ts.SyntaxKind.PlusToken:return a+b;case ts.SyntaxKind.MinusToken:return a-b;case ts.SyntaxKind.AsteriskToken:return a*b;case ts.SyntaxKind.SlashToken:return a/b;}
    }
    throw new Error(`Unsupported checksum node ${n.getText(source).slice(0,80)}`);
  }
  let turns=0;while(read(checksum.initializer)!==target&&turns<table.length){table.push(table.shift());turns++;}
  if(turns===table.length)throw new Error(`Rotation checksum not solved: ${name}`);
  let replaced=0, unresolved=0;
  const result=ts.transform(source,[context=>{const visit=n=>{
    if(n===rotate)return n;
    if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&aliases.has(n.expression.text)&&n.arguments.length&&ts.isNumericLiteral(n.arguments[0])) {
      const value=table[Number(n.arguments[0].text)-offset];if(value===undefined)throw new Error('String index outside table');replaced++;return ts.factory.createStringLiteral(value);
    }
    if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&aliases.has(n.expression.text))unresolved++;
    if(ts.isStringLiteral(n))return ts.factory.createStringLiteral(n.text);
    return ts.visitEachChild(n,visit,context);
  };return n=>ts.visitNode(n,visit);}]);
  fs.writeFileSync(path.join(root,`${name}.decoded.js`),ts.createPrinter().printFile(result.transformed[0]));result.dispose();
  return {name,status:'decoded',replaced,unresolvedCalls:unresolved,rotations:turns};
}

const names=process.argv.includes('--all') ? fs.readdirSync(root).filter(name=>/^[\w.-]+\.js$/.test(name)&&!name.includes('.decoded.')&&!name.includes('.readable.')) : ['BncsZwa32.js','Brm6UpoL2.js','DhCS0mTK2.js','ChLOT5ZK.js'];
const report=[];
for(const name of names) {
  try {report.push(decode(name));}
  catch(error) {report.push({name,status:'not-decoded',reason:error.message});}
}
fs.writeFileSync(path.join(root,'deobfuscation-report.json'),JSON.stringify(report,null,2));
const decoded=report.filter(item=>item.status==='decoded');
console.log(JSON.stringify({modules:names.length,decoded:decoded.length,replaced:decoded.reduce((sum,item)=>sum+item.replaced,0),unresolvedCalls:decoded.reduce((sum,item)=>sum+item.unresolvedCalls,0),notDecoded:report.filter(item=>item.status!=='decoded')},null,2));
if(!decoded.length)process.exitCode=1;
