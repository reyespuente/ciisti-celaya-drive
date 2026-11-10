import {MAX_FILE,cleanName,ownedKey,validId} from '../server/security.js';
// ponytail: límite por isolate de la demo. Usar un límite distribuido al abrir registro público.
const hits=new Map();
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
async function readFile(request,limit=MAX_FILE){
  const reader=request.body?.getReader();if(!reader)throw new Error('El archivo está vacío');
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error(limit===MAX_FILE?'Máximo 10 MiB por archivo':'Solicitud inválida');}chunks.push(value);}
  if(!size)throw new Error('El archivo está vacío');const out=new Uint8Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength;}return out;
}
async function handle(request,env){
  const url=new URL(request.url),p=url.pathname;
  if(p==='/health')return json({ok:true,service:'ciisti-drive-api',runtime:'cloudflare-workers'});
  if(!p.startsWith('/api/'))return json({error:'Ruta no encontrada'},404);
  if(!env.SUPABASE_URL||!env.SUPABASE_PUBLISHABLE_KEY||!env.BUCKET)return json({error:'Falta configurar el backend'},503);
  const token=request.headers.get('Authorization');if(!token?.startsWith('Bearer '))return json({error:'Inicia sesión'},401);
  const headers={apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:token};
  const auth=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers});if(!auth.ok)return json({error:'Sesión vencida'},401);
  const user=await auth.json();if(!validId(user.id))return json({error:'Sesión inválida'},401);
  const now=Date.now();if(hits.size>2000)for(const[id,v]of hits)if(v.reset<now)hits.delete(id);
  let h=hits.get(user.id);if(!h||h.reset<now){h={n:0,reset:now+60000};hits.set(user.id,h);}if(++h.n>60)return json({error:'Espera un minuto antes de continuar'},429);
  async function db(params={},method='GET',body){
    const response=await fetch(env.SUPABASE_URL+'/rest/v1/entries?'+new URLSearchParams(params),{method,headers:{...headers,'Content-Type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok)throw new Error('No se pudo consultar o guardar los metadatos');return response.status===204?[]:response.json();
  }
  async function row(id){if(!validId(id))throw new Error('Identificador inválido');const rows=await db({id:'eq.'+id,select:'*'});if(rows.length!==1)throw new Error('Elemento no disponible');return rows[0];}
  async function parent(id){if(!id)return null;const r=await row(id);if(r.kind!=='folder'||r.trashed)throw new Error('La carpeta no está disponible');return id;}
  async function body(){if(Number(request.headers.get('Content-Length'))>4096)throw new Error('Solicitud inválida');return JSON.parse(new TextDecoder().decode(await readFile(request,4096)));}
  if(p==='/api/entries'&&request.method==='GET')return json(await db({select:'*',order:'created_at.desc',limit:'1000'}));
  if(p==='/api/folders'&&request.method==='POST'){
    const data=await body(),name=cleanName(data.name),parent_id=await parent(data.parent_id);
    return json((await db({},'POST',{name,parent_id,kind:'folder',owner_id:user.id}))[0],201);
  }
  if(p==='/api/upload'&&request.method==='POST'){
    const name=cleanName(decodeURIComponent(request.headers.get('X-File-Name')||''));
    const parent_id=await parent(request.headers.get('X-Folder-Id'));
    const file=await readFile(request),key=user.id+'/'+crypto.randomUUID();
    const mime=request.headers.get('Content-Type')||'application/octet-stream';
    await env.BUCKET.put(key,file,{httpMetadata:{contentType:mime}});
    try{return json((await db({},'POST',{name,parent_id,kind:'file',object_key:key,size:file.byteLength,mime,owner_id:user.id}))[0],201);}
    catch(e){await env.BUCKET.delete(key).catch(()=>{});throw e;}
  }
  const match=p.match(/^\/api\/entries\/([a-f0-9-]+)(\/download)?$/i);if(!match)return json({error:'Ruta no encontrada'},404);
  const r=await row(match[1]);
  if(match[2]&&request.method==='GET'){
    if(r.kind!=='file'||r.trashed||!ownedKey(r.object_key,user.id))return json({error:'No permitido'},403);
    const object=await env.BUCKET.get(r.object_key);if(!object)return json({error:'Archivo no disponible'},404);
    return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(object.size),'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(r.name).replace(/'/g,'%27')}`,'Cache-Control':'private, no-store'}});
  }
  if(match[2])return json({error:'Método no permitido'},405);
  if(request.method==='PATCH'){
    const data=await body(),patch={};if('name'in data)patch.name=cleanName(data.name);
    for(const k of ['starred','trashed'])if(typeof data[k]==='boolean')patch[k]=data[k];
    if(patch.trashed===true&&(await db({parent_id:'eq.'+r.id,select:'id',limit:'1'})).length)return json({error:'Vacía primero la carpeta, incluida su papelera'},409);
    return json((await db({id:'eq.'+r.id},'PATCH',patch))[0]);
  }
  if(request.method==='DELETE'){
    if(!r.trashed)return json({error:'Mueve primero a papelera'},409);
    if(r.kind==='file'){if(!ownedKey(r.object_key,user.id))return json({error:'No permitido'},403);await env.BUCKET.delete(r.object_key);}
    await db({id:'eq.'+r.id},'DELETE');return new Response(null,{status:204});
  }
  return json({error:'Método no permitido'},405);
}
export default {
  async fetch(request,env){
    const origin=request.headers.get('Origin');const allowed=(env.ALLOWED_ORIGINS||'').split(',').map(v=>v.trim());
    let response;
    if(origin&&!allowed.includes(origin))response=json({error:'Origen no permitido'},403);
    else if(request.method==='OPTIONS')response=new Response(null,{status:204});
    else try{response=await handle(request,env);}catch(error){const message=error.message;response=json({error:message==='Máximo 10 MiB por archivo'?message:'No se pudo completar la operación. Revisa la configuración o inténtalo de nuevo.'},message==='Máximo 10 MiB por archivo'?413:400);}
    const out=new Response(response.body,response);out.headers.set('Cache-Control','private, no-store');out.headers.set('X-Content-Type-Options','nosniff');out.headers.set('Referrer-Policy','no-referrer');
    if(origin&&allowed.includes(origin)){out.headers.set('Access-Control-Allow-Origin',origin);out.headers.set('Vary','Origin');out.headers.set('Access-Control-Allow-Headers','Authorization,Content-Type,X-File-Name,X-Folder-Id');out.headers.set('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');}
    return out;
  }
};
