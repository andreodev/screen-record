"""Extract only cursor/background assets from the local ASAR; leave installation untouched."""
import collections
import hashlib
import html
import json
from pathlib import Path, PurePosixPath
import struct
import sys

archive = Path(sys.argv[1] if len(sys.argv)>1 else '/Applications/Screen Studio.app/Contents/Resources/app.asar')
output = Path(sys.argv[2] if len(sys.argv)>2 else '/Users/andreodev/Screen Studio Recovered').resolve()
manifest=[]
with archive.open('rb') as source:
    prefix=source.read(16)
    if len(prefix)!=16: raise ValueError('Invalid ASAR header')
    _,header_size,_,json_size=struct.unpack('<4I',prefix)
    if not 2 <= json_size <= 32*1024*1024 or header_size+8 < json_size+16: raise ValueError('Invalid ASAR header')
    tree=json.loads(source.read(json_size));base=8+header_size
    def walk(nodes, parts=()):
        for name,entry in nodes.items():
            if name in ['.', '..'] or '/' in name or '\\' in name: raise ValueError('Unsafe path')
            path=parts+(name,)
            if 'files' in entry:
                if not parts and name!='assets': continue
                if parts==('assets',) and name not in ['backgrounds','cursors']: continue
                walk(entry['files'],path)
            elif path[:2] in [('assets','backgrounds'),('assets','cursors')]:
                size=entry['size'];offset=int(entry['offset'])
                if size<0 or offset<0 or base+offset+size>archive.stat().st_size: raise ValueError('Invalid asset bounds')
                target=output.joinpath(*path);target.parent.mkdir(parents=True,exist_ok=True)
                source.seek(base+offset);data=source.read(size)
                if len(data)!=size: raise ValueError('Incomplete asset')
                target.write_bytes(data)
                manifest.append({'path':'/'.join(path),'bytes':size,'sha256':hashlib.sha256(data).hexdigest()})
    walk(tree['files'])
(output/'metadata').mkdir(parents=True,exist_ok=True)
(output/'metadata/assets.json').write_text(json.dumps(manifest,indent=2))
sections=[]
for kind,title in [('backgrounds','Wallpapers'),('cursors','Cursores')]:
    groups=collections.defaultdict(list)
    for entry in manifest:
        parts=PurePosixPath(entry['path']).parts
        if parts[1]!=kind:continue
        group=parts[2] if kind=='backgrounds' else '/'.join(parts[2:-1]) or 'principais'
        rel=html.escape(entry['path'],quote=True);label=html.escape(parts[-1]);caption=html.escape(group)
        groups[group].append(f'<a class="asset {kind}" href="{rel}"><img loading="lazy" src="{rel}" alt="{label}"><span>{label}</span></a>')
    sections.append(f'<section id="{kind}"><h1>{title}</h1>'+''.join(f'<h2>{html.escape(group)} · {len(items)}</h2><div class="grid">'+''.join(items)+'</div>' for group,items in sorted(groups.items()))+'</section>')
page='''<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Screen Studio · recursos locais</title><style>
body{margin:0;background:#0b0c10;color:#eee;font:14px -apple-system,sans-serif}main{max-width:1400px;padding:36px;margin:auto}nav{display:flex;gap:24px;position:sticky;top:0;background:#0b0c10f0;padding:18px 0;border-bottom:1px solid #ffffff15}a{color:#c8b5ff;text-decoration:none}h1{font-size:30px;font-weight:500;margin:40px 0 14px}h2{font-size:17px;margin-top:35px;color:#aaa}p{color:#aaa;line-height:1.7}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:15px}.asset{padding:12px;border:1px solid #ffffff13;border-radius:12px;background:#17181f;display:flex;flex-direction:column;gap:12px;min-width:0}.asset:hover{border-color:#a98aff}.asset img{width:100%;height:120px;object-fit:contain}.backgrounds img{object-fit:cover;border-radius:7px}.cursors img{padding:20px;box-sizing:border-box;background:linear-gradient(135deg,#353642,#292a33);border-radius:7px}.asset span{font-size:11px;overflow-wrap:anywhere;color:#aaa}code{color:#ddd}li{margin:12px 0}
</style><main><nav><a href="#backgrounds">Wallpapers</a><a href="#cursors">Cursores</a><a href="#animations">Animações</a></nav><h1>Recursos do Screen Studio instalado</h1><p>Extraídos localmente do pacote 4.1.0-5005. Clique para abrir o arquivo original recuperado. O tamanho dos cursores nesta galeria é ilustrativo.</p>'''+''.join(sections)+'''<section id="animations"><h1>Animações</h1><p>Os controles e a simulação encontrados estão em JavaScript. Não foram encontrados clips de animação com nomes correspondentes entre os recursos inspecionados. A coleção de wallpapers chamada “Spring” é uma coleção de imagens.</p><ul><li><a href="javascript/Brm6UpoL2.js">Controles: tela, cursor e motion blur</a></li><li><a href="javascript/ChLOT5ZK.js">Gerenciador de molas</a></li><li><a href="javascript/CpXpNcFh.js">Simulação de movimento</a></li><li><a href="javascript/B39sgn5K.js">Tratamento e configuração do cursor</a></li><li><a href="javascript/B9ZROmpI.js">Carregamento e análise dos recursos de cursor</a></li></ul><p>São módulos recuperados, com imports e nomes locais ainda ofuscados. Não são demos independentes nem fontes originais do repositório.</p></section></main></html>'''
(output/'catalogo.html').write_text(page)
counts=collections.Counter(PurePosixPath(row['path']).parts[1] for row in manifest)
print(json.dumps({'files':dict(counts),'bytes':sum(row['bytes'] for row in manifest),'catalog':str(output/'catalogo.html')},ensure_ascii=False))
