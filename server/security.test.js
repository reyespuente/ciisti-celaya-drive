import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanName, ownedKey, validId, MAX_FILE} from './security.js';
test('rechaza nombres peligrosos y objetos de otro usuario',()=>{
  assert.equal(cleanName('  informe.pdf '),'informe.pdf');
  for (const name of ['', '../x', 'a/b', 'a\\b', '\u0000', 'x'.repeat(151)]) assert.throws(()=>cleanName(name));
  assert.equal(ownedKey('ana/archivo','ana'),true);
  assert.equal(ownedKey('anabel/archivo','ana'),false);
  assert.equal(ownedKey('ana/../otro','ana'),false);
  assert.equal(validId('57f681a5-6c50-47b4-a529-81ad1ec128d3'),true);
  assert.equal(validId('bad-id'),false);
  assert.equal(MAX_FILE,10485760);
});
