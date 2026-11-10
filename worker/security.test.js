import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';
test('Worker bloquea solicitudes sin sesión, orígenes ajenos y objetos de otro propietario',async()=>{
 const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 const env={SUPABASE_URL:'https://test.invalid',SUPABASE_PUBLISHABLE_KEY:'public-test',ALLOWED_ORIGINS:'https://demo.invalid',BUCKET:{get(){throw new Error('No debe leer R2');}}};
 assert.equal((await worker.fetch(new Request('https://api.invalid/health'),env)).status,200);
 assert.equal((await worker.fetch(new Request('https://api.invalid/api/entries'),env)).status,401);
 assert.equal((await worker.fetch(new Request('https://api.invalid/api/entries',{headers:{Origin:'https://otro.invalid'}}),env)).status,403);
 const original=globalThis.fetch;
 globalThis.fetch=async url=>String(url).endsWith('/auth/v1/user')?Response.json({id:owner}):Response.json([{id:other,kind:'file',trashed:false,object_key:other+'/archivo',name:'privado.txt'}]);
 try{assert.equal((await worker.fetch(new Request('https://api.invalid/api/entries/'+other+'/download',{headers:{Authorization:'Bearer test'}}),env)).status,403);}finally{globalThis.fetch=original;}
});
