import { describe, it, expect } from 'vitest';
import { effectiveRows } from './ajson-display.js';
describe('effective AJSON configuration', () => {
  it('reports merged transport rather than the template label, without credentials', () => {
    const rows = effectiveRows({ protocol:'vless', use:'ws', uuid:'secret', security:{type:'reality',publicKey:'secret'}, transport:{type:'xhttp',path:'/x'} }, {ws:{transport:{type:'ws',path:'/'}}});
    expect(rows).toContainEqual(['传输方式','XHTTP']);
    expect(rows).toContainEqual(['路径','/x']);
    expect(rows).toContainEqual(['连接安全','Reality']);
    expect(JSON.stringify(rows)).not.toContain('secret');
  });
  it('shows a template value omitted from the serialized native proxy', () => {
    expect(effectiveRows({protocol:'nowhere',use:'quiet'},{quiet:{morph:false,morphPrelude:'low7'}})).toContainEqual(['Morph','关闭']);
    expect(effectiveRows({link:'nowhere://secret'})).toEqual([]);
  });
});
