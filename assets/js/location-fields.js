import { countiesForCity, citiesForCounty } from './florida-places.js';

const form = document.getElementById('fltract-intake');
if (form) {
  const city = form.elements.city;
  const county = form.elements.county;
  const list = document.getElementById('florida-city-options');
  const hint = document.getElementById('location-help');
  let automaticCounty = '';
  function suggestCities() {
    list.replaceChildren(...citiesForCounty(county.value).map(name => {
      const option = document.createElement('option');
      option.value = name;
      return option;
    }));
  }
  function resolveCity() {
    if (automaticCounty && county.value === automaticCounty) county.value = '';
    automaticCounty = '';
    const matches = countiesForCity(city.value);
    if (matches.length === 1 && (!county.value || county.value === 'Not Sure')) {
      county.value = matches[0];
      automaticCounty = county.value;
      county.dispatchEvent(new Event('change', { bubbles: true }));
      automaticCounty = county.value;
      hint.textContent = `${matches[0]} County filled from the city. Confirm or change it if the property is outside that county.`;
    } else if (matches.length > 1) {
      hint.textContent = `This place is listed in ${matches.join(', ')} counties. Choose the property's county, or Not Sure.`;
    } else if (matches.length === 1 && county.value !== matches[0]) {
      hint.textContent = `The city is listed in ${matches[0]} County. We kept your selected county because a nearby city may be across the county line.`;
    } else {
      hint.textContent = 'Enter either location you know. Choose Not Sure if the county is unknown; we can review the location with you.';
    }
    suggestCities();
  }
  city.addEventListener('input', resolveCity);
  county.addEventListener('change', () => { automaticCounty = ''; suggestCities(); });
  form.addEventListener('reset', () => {
    automaticCounty = '';
    hint.textContent = 'Enter either location you know. A nearby city helps us locate the area; it does not identify a parcel.';
    // The reset event runs before the native form reset finishes.
    queueMicrotask(suggestCities);
  });
  suggestCities();
  if (city.value) resolveCity();
}
