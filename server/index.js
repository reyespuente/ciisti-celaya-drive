import express from 'express';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {cleanName,ownedKey,validId,MAX_FILE} from './security.js';
const required=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','R2_ENDPOINT','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET','ALLOWED_ORIGINS'];
for(const key of required) if(!process.env[key]) throw new Error(`Falta configurar ${key}`);
const app=express(), origins=process.env.ALLOWED_ORIGINS.split(',').map(s=>s.trim());
const s3=new S3Client({region:'auto',endpoint:process.env.R2_ENDPOINT,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}});
const Bucket=process.env.R2_BUCKET;
app.disable('x-powered-by');
app.use((req,res,next)=>{
  res.set({'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  const origin=req.get('origin');
  if(origin && !origins.includes(origin)) return res.status(403).json({error:'Origen no permitido'});
  if(origin) res.set({'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'Authorization,Content-Type,X-File-Name,X-Folder-Id','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS'});
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
});
app.get('/health',(_req,res)=>res.json({ok:true,service:'ciisti-drive-api'}));
// ponytail: límite en memoria para una instancia de demo. Usar Redis para varias réplicas.
const hits=new Map();
setInterval(()=>{const now=Date.now();for(const [id,v]of hits)if(v.reset<now)hits.delete(id);},60000).unref();
app.use('/api',async(req,res,next)=>{
  try{
    const token=req.get('authorization');
    if(!token?.startsWith('Bearer ')) return res.status(401).json({error:'Inicia sesión'});
    req.db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_PUBLISHABLE_KEY,{global:{headers:{Authorization:token}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await req.db.auth.getUser(token.slice(7));
    if(error||!data.user) return res.status(401).json({error:'Sesión vencida'});
    req.user=data.user;
    let hit=hits.get(data.user.id);
    if(!hit||hit.reset<Date.now()){hit={n:0,reset:Date.now()+60000};hits.set(data.user.id,hit);}
    if(++hit.n>60) return res.status(429).json({error:'Espera un minuto antes de continuar'});
    next();
  }catch(error){next(error);}
});
const jsonParser=express.json({limit:'4kb'});
app.use((req,res,next)=>req.path==='/api/upload'?next():jsonParser(req,res,next));
const checked=({data,error})=>{if(error)throw new Error('No se pudo guardar o consultar los metadatos');return data;};
async function parent(db,id){if(!id)return null;if(!validId(id))throw new Error('Carpeta inválida');const row=checked(await db.from('entries').select('id,kind,trashed').eq('id',id).single());if(row.kind!=='folder'||row.trashed)throw new Error('La carpeta no está disponible');return id;}
app.get('/api/entries',async(req,res)=>res.json(checked(await req.db.from('entries').select('*').order('created_at',{ascending:false}).limit(1000))));
app.post('/api/folders',async(req,res)=>{
  const name=cleanName(req.body.name),parent_id=await parent(req.db,req.body.parent_id);
  res.status(201).json(checked(await req.db.from('entries').insert({name,parent_id,kind:'folder',owner_id:req.user.id}).select().single()));
});
app.post('/api/upload',express.raw({type:()=>true,limit:MAX_FILE}),async(req,res)=>{
  const name=cleanName(decodeURIComponent(req.get('x-file-name')||''));
  const parent_id=await parent(req.db,req.get('x-folder-id')||null);
  if(!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({error:'El archivo está vacío'});
  const key=`${req.user.id}/${randomUUID()}`;
  const mime=(req.get('content-type')||'application/octet-stream').slice(0,200);
  await s3.send(new PutObjectCommand({Bucket,Key:key,Body:req.body,ContentType:mime}));
  try{
    const row=checked(await req.db.from('entries').insert({name,parent_id,kind:'file',object_key:key,size:req.body.length,mime,owner_id:req.user.id}).select().single());
    res.status(201).json(row);
  }catch(error){await s3.send(new DeleteObjectCommand({Bucket,Key:key})).catch(()=>{});throw error;}
});
app.get('/api/entries/:id/download',async(req,res)=>{
  if(!validId(req.params.id))return res.sendStatus(400);
  const row=checked(await req.db.from('entries').select('*').eq('id',req.params.id).single());
  if(row.kind!=='file'||row.trashed||!ownedKey(row.object_key,req.user.id))return res.sendStatus(403);
  const url=await getSignedUrl(s3,new GetObjectCommand({Bucket,Key:row.object_key,ResponseContentType:'application/octet-stream',ResponseContentDisposition:`attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`}),{expiresIn:60});
  res.json({url});
});
app.patch('/api/entries/:id',async(req,res)=>{
  if(!validId(req.params.id))return res.sendStatus(400);
  const patch={};
  if('name'in req.body)patch.name=cleanName(req.body.name);
  for(const key of ['starred','trashed'])if(typeof req.body[key]==='boolean')patch[key]=req.body[key];
  // Solo carpetas vacías a papelera: evita ocultar archivos todavía activos.
  if(patch.trashed===true){const children=checked(await req.db.from('entries').select('id').eq('parent_id',req.params.id).limit(1));if(children.length)return res.status(409).json({error:'Vacía primero la carpeta, incluida su papelera'});}
  res.json(checked(await req.db.from('entries').update(patch).eq('id',req.params.id).select().single()));
});
app.delete('/api/entries/:id',async(req,res)=>{
  if(!validId(req.params.id))return res.sendStatus(400);
  const row=checked(await req.db.from('entries').select('*').eq('id',req.params.id).single());
  if(!row.trashed)return res.status(409).json({error:'Mueve primero a papelera'});
  if(row.kind==='file'){
    if(!ownedKey(row.object_key,req.user.id))return res.sendStatus(403);
    await s3.send(new DeleteObjectCommand({Bucket,Key:row.object_key}));
  }
  checked(await req.db.from('entries').delete().eq('id',row.id));res.sendStatus(204);
});
app.use((error,_req,res,_next)=>{res.status(error.type==='entity.too.large'?413:400).json({error:error.type==='entity.too.large'?'Máximo 10 MiB por archivo':error.message?.startsWith('Usa ')||error.message?.startsWith('La carpeta')?error.message:'No se pudo completar la operación. Revisa la configuración o inténtalo de nuevo.'});});
app.listen(process.env.PORT||3001,'0.0.0.0',()=>console.log('API lista en puerto '+(process.env.PORT||3001)));
