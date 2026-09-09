import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuse, normalizeUrl, parseDenylist, parseRow, toMatch } from './lib.js';

const good = {
  url: 'https://a.com/p',
  title: 'A title',
  text: 'Some body text.',
  first_at: 1000,
  last_at: 2000,
  visits: 3,
};
const line = (extra) => JSON.stringify({ ...good, ...extra });

test('normalizeUrl drops tracking parameters', () => {
  assert.equal(normalizeUrl('https://a.com/p?utm_source=x&id=5'), 'https://a.com/p?id=5');
  assert.equal(normalizeUrl('https://a.com/p?fbclid=abc'), 'https://a.com/p');
  assert.equal(normalizeUrl('https://a.com/p?gclid=a&msclkid=b&igshid=c'), 'https://a.com/p');
});

test('normalizeUrl keeps parameters that change what you read', () => {
  assert.equal(normalizeUrl('https://a.com/p?id=5&referrer=x'), 'https://a.com/p?id=5&referrer=x');
  assert.equal(normalizeUrl('https://a.com/p?page=3'), 'https://a.com/p?page=3');
});

test('normalizeUrl turns many links to one article into one row', () => {
  const canonical = 'https://a.com/p?id=5';
  assert.equal(normalizeUrl('https://www.a.com/p?id=5'), canonical);
  assert.equal(normalizeUrl('https://a.com/p?id=5#intro'), canonical);
  assert.equal(normalizeUrl('https://a.com/p?utm_campaign=n&id=5'), canonical);
  assert.equal(normalizeUrl('https://A.COM/p?id=5'), canonical);
});

test('normalizeUrl sorts parameters, so link order stops mattering', () => {
  assert.equal(normalizeUrl('https://a.com/p?b=2&a=1'), normalizeUrl('https://a.com/p?a=1&b=2'));
});

test('normalizeUrl rejects a value that is not a URL', () => {
  assert.throws(() => normalizeUrl('not a url'));
});

test('normalizeUrl leaves a trailing slash alone, which is a known limit', () => {
  assert.notEqual(normalizeUrl('https://a.com/p'), normalizeUrl('https://a.com/p/'));
});

test('toMatch quotes every word and lets the last one grow', () => {
  assert.equal(toMatch('hello world'), '"hello" "world"*');
  assert.equal(toMatch('sql'), '"sql"*');
  assert.equal(toMatch('  spaced   out  '), '"spaced" "out"*');
});

test('toMatch survives punctuation that would otherwise break FTS5', () => {
  assert.equal(toMatch("don't"), '"don\'t"*');
  assert.equal(toMatch('state-of-the-art'), '"state-of-the-art"*');
  assert.equal(toMatch('say "hi"'), '"say" """hi"""*');
  assert.equal(toMatch('a OR b'), '"a" "OR" "b"'); // "b" is too short to match by prefix
});

test('toMatch only matches by prefix once the word is long enough', () => {
  assert.equal(toMatch('quantum'), '"quantum"*');
  assert.equal(toMatch('qua'), '"qua"*');
  assert.equal(toMatch('qu'), '"qu"');
  assert.equal(toMatch('a'), '"a"');
  assert.equal(toMatch('neural ne'), '"neural" "ne"');
});

test('toMatch returns nothing for an empty box, which means browse', () => {
  assert.equal(toMatch(''), '');
  assert.equal(toMatch('   '), '');
});

test('parseDenylist reduces a pasted address to a bare host', () => {
  assert.deepEqual(parseDenylist('https://www.mybank.com/login?x=1'), ['mybank.com']);
  assert.deepEqual(parseDenylist('http://example.com'), ['example.com']);
  assert.deepEqual(parseDenylist('  MyBank.COM  '), ['mybank.com']);
});

test('parseDenylist drops blank lines and repeats', () => {
  assert.deepEqual(parseDenylist('a.com\n\n  \nb.com\na.com\nwww.a.com'), ['a.com', 'b.com']);
  assert.deepEqual(parseDenylist(''), []);
});

test('parseDenylist keeps a subdomain, because blocking one is legitimate', () => {
  assert.deepEqual(parseDenylist('mail.google.com'), ['mail.google.com']);
});

test('fuse keeps the order of a single ranking', () => {
  assert.deepEqual(fuse([[7, 3, 9]]), [7, 3, 9]);
});

test('fuse puts a page both rankings like above one only half of them found', () => {
  const order = fuse([
    [1, 2, 3, 4, 5],
    [5, 6, 7, 8, 1],
  ]);
  assert.ok(order.indexOf(1) < order.indexOf(2));
  assert.ok(order.indexOf(5) < order.indexOf(2));
});

test('fuse still returns a page only one ranking found', () => {
  assert.deepEqual(fuse([[1], [2]]), [1, 2]);
});

test('fuse handles nothing at all', () => {
  assert.deepEqual(fuse([]), []);
  assert.deepEqual(fuse([[], []]), []);
});

test('parseRow accepts a row this extension wrote', () => {
  assert.deepEqual(parseRow(line()), good);
});

test('parseRow rejects a line that is not usable', () => {
  assert.equal(parseRow('not json'), null);
  assert.equal(parseRow(''), null);
  assert.equal(parseRow('null'), null);
  assert.equal(parseRow('[1,2,3]'), null);
  assert.equal(parseRow(line({ url: 5 })), null);
  assert.equal(parseRow(line({ title: null })), null);
  assert.equal(parseRow(line({ text: '' })), null);
});

test('parseRow rejects an address that is not a web page', () => {
  assert.equal(parseRow(line({ url: 'javascript:alert(1)' })), null);
  assert.equal(parseRow(line({ url: 'file:///etc/passwd' })), null);
  assert.equal(parseRow(line({ url: 'nonsense' })), null);
});

test('parseRow rejects dates it cannot use', () => {
  assert.equal(parseRow(line({ first_at: 'yesterday' })), null);
  assert.equal(parseRow(line({ last_at: undefined })), null);
});

test('parseRow repairs what it safely can', () => {
  assert.equal(parseRow(line({ visits: -4 })).visits, 1);
  assert.equal(parseRow(line({ visits: 'many' })).visits, 1);
  assert.equal(parseRow(line({ visits: 2.7 })).visits, 2);

  const swapped = parseRow(line({ first_at: 9000, last_at: 1000 }));
  assert.equal(swapped.first_at, 1000);
  assert.equal(swapped.last_at, 9000);
});
