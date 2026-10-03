// Optional public form extension. No owner data or research results are exposed here.
(function () {
  const config = window.intakeModules?.propertyRecords;
  if (!config?.enabled) return;
  const form = document.getElementById(config.formId || 'fltract-intake');
  const location = form?.elements.property_location;
  if (!location || form.elements.parcel_id) return;
  const grid = location.closest('.form-grid');
  const typeLabel = document.createElement('label');
  typeLabel.textContent = 'What information are you entering below?';
  const type = document.createElement('select');
  type.name = 'property_location_kind';
  [['general', 'General location or other property information'], ['address', 'Property street address']].forEach(([value, title]) => {
    const option = document.createElement('option'); option.value = value; option.textContent = title; type.append(option);
  });
  typeLabel.append(type);
  const parcelLabel = document.createElement('label');
  parcelLabel.textContent = 'Parcel / Folio ID (if known)';
  const parcel = document.createElement('input');
  parcel.type = 'text'; parcel.name = 'parcel_id'; parcel.maxLength = 100;
  parcel.placeholder = 'Optional — include any leading zeros';
  parcelLabel.append(parcel);
  grid.insertBefore(typeLabel, location.closest('label'));
  grid.insertBefore(parcelLabel, location.closest('label'));
  // FormData automatically includes these fields and form.reset clears them for another property.
})();
