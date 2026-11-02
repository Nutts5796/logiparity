import { expect, it } from 'vitest';
import { selectJson, selectOne } from '../../packages/adapters/src/jsonpath.js';

it('extracts properties, quoted keys, array indexes and wildcard values without evaluating code', () => {
  expect(selectJson({ data: [{ id: 1 }, { id: 2 }] }, '$.data[*].id')).toEqual([1, 2]);
  expect(selectOne({ 'a.b': [4] }, "$['a.b'][0]")).toBe(4);
  expect(selectOne({ x: 5 }, '$["x"]')).toBe(5);
  expect(selectJson([], '$[*]')).toEqual([]);
  expect(selectOne('scalar', '$')).toBe('scalar');
  expect(() => selectJson({}, 'data')).toThrow('start');
  expect(() => selectJson({}, '$..data')).toThrow('Unsupported');
  expect(() => selectJson({}, '$[?(@.x)]')).toThrow('Unsupported');
  expect(() => selectJson({}, '$.__proto__')).toThrow('missing');
  expect(() => selectJson({ x: null }, '$.x.y')).toThrow('missing');
  expect(() => selectJson({}, '$[*]')).toThrow('array');
  expect(() => selectOne([1, 2], '$[*]')).toThrow('exactly one');
});
