import {expect,it} from 'vitest';
import {redactSecrets,safeConsole} from '@logiparity/core';
import {redactInput} from '@logiparity/ai';
import {requestPlan} from '../../packages/scenarios/src/http.js';
import {targetSchema} from '@logiparity/scenarios';
it('redacts short secrets only as whole tokens',()=>{
  const secrets=['config','y','1'];
  expect(redactSecrets('invalid configuration target.yaml L1001',secrets)).toBe('invalid configuration target.yaml L1001');
  expect(redactSecrets('config y 1 /config.csv?token=y',secrets)).toBe('[REDACTED] [REDACTED] [REDACTED] /[REDACTED].csv?token=[REDACTED]');
  expect(redactSecrets('prefix-long-secret-suffix',['long-secret'])).toBe('prefix-[REDACTED]-suffix');
});
it.each(['ab:cd{ef','x;y`z^','space and+plus'])('redacts URI, WHATWG path/query and form encodings of %s',secret=>{
  const path=new URL('https://example.test');path.pathname='/nope/'+secret+'/orders';
  const query=new URL('https://example.test');query.search='?token='+secret;
  const variants=[secret,encodeURIComponent(secret),encodeURI(secret),path.pathname.slice(6,-7),query.search.slice(7),new URLSearchParams({value:secret}).toString().slice(6)];
  for(const variant of variants)expect(redactSecrets(`/nope/${variant}/orders`,[secret])).toBe('/nope/[REDACTED]/orders');
  const encoded=encodeURIComponent(encodeURI(secret));
  expect(redactSecrets(`/nope/${encoded}/orders`,[secret])).toBe('/nope/[REDACTED]/orders');
});
it.each(['redis://:RedisOnlyPw77@cache','https://ghp_UserOnlyToken1234@github.com','Authorization: Basic dXNlclNlY3JldDo=','api_key=NameValueSecret77','password: "name value secret"'])('masks textual credentials and global copies: %s',value=>{
  const result=redactInput({note:value});
  expect(JSON.stringify(result.data)).toContain('[REDACTED]');
  expect(JSON.stringify(result.data)).not.toMatch(/RedisOnlyPw77|ghp_UserOnlyToken1234|dXNlclNlY3JldDo=|NameValueSecret77|name value secret/);
  expect(result.scrub(value)).not.toMatch(/RedisOnlyPw77|ghp_UserOnlyToken1234|dXNlclNlY3JldDo=|NameValueSecret77|name value secret/);
});
it('does not globally scrub copies of short textual credentials',()=>{
  const result=redactInput({note:'password=tiny',other:'tiny L1001',auth_retries:1});
  expect(result.data).toMatchObject({note:'password=[REDACTED]',other:'tiny L1001'});
});
it('strips bidi controls and line/paragraph separators from console output',()=>{
  expect(safeConsole('a\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069\u2028\u2029b\n\t')).toBe('ab\n\t');
});
it.each(['/a/..;x/b','/a/%2e%2e%3bx/b','/a/%252e%252e%253bx/b'])('rejects semicolon dot-segment path %s',path=>{
  const target=targetSchema.parse({version:1,name:'test',environment:'test',allowMutations:true,baseUrl:'http://localhost',events:{},state:{orders:{type:'csv',file:'unused.csv',fields:{id:'ID'}}}});
  expect(()=>requestPlan(target,{method:'POST',path},{})).toThrow('dot-segments');
});
