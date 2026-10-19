import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { countiesForCity, citiesForCounty, placeRows } from '../../../assets/js/florida-places.js';

test('directory resolves exact cities without guessing partial or multi-county places', () => {
  assert.deepEqual(countiesForCity(' Vero Beach, FL '), ['Indian River']);
  assert.deepEqual(countiesForCity('Fort Pierce'), ['St. Lucie']);
  assert.deepEqual(countiesForCity('Fanning Springs'), ['Gilchrist', 'Levy']);
  assert.deepEqual(countiesForCity('Vero'), []);
  assert.deepEqual(countiesForCity('Unknown test city'), []);
  assert.ok(citiesForCounty('Indian River').includes('Vero Beach'));
  assert.ok(!citiesForCounty('Indian River').includes('Miami'));
  const html = readFileSync(new URL('../../../contact/index.html', import.meta.url), 'utf8');
  const counties = new Set([...html.matchAll(/<option>([^<]+)<\/option>/g)].map(x => x[1]));
  for (const [, county] of placeRows) assert.ok(counties.has(county), county);
});

test('actual browser module fills, clears stale suggestions, preserves manual county and resets', () => {
  const field = value => ({value, handlers:{}, addEventListener(n,f){this.handlers[n]=f;}, dispatchEvent(e){this.handlers[e.type]?.();}});
  const city=field(''), county=field(''), form=field(''); form.elements={city,county};
  const hint={textContent:''}, list={replaceChildren(...items){this.items=items;}};
  const document={getElementById(id){return {'fltract-intake':form,'location-help':hint,'florida-city-options':list}[id];},createElement(){return {};}};
  const source=readFileSync(new URL('../../../assets/js/location-fields.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/,'');
  vm.runInNewContext(source,{document,countiesForCity,citiesForCounty,Event,queueMicrotask: f=>f()});
  city.value='Vero Beach'; city.handlers.input(); assert.equal(county.value,'Indian River');
  city.value='Vero'; city.handlers.input(); assert.equal(county.value,'');
  city.value='Fanning Springs'; city.handlers.input(); assert.equal(county.value,''); assert.match(hint.textContent,/Gilchrist, Levy/);
  county.value='Brevard'; county.handlers.change(); city.value='Vero Beach'; city.handlers.input(); assert.equal(county.value,'Brevard');
  assert.match(hint.textContent,/kept your selected county/);
  form.handlers.reset(); assert.match(hint.textContent,/does not identify a parcel/);
});
