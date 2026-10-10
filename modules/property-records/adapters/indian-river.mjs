// Labels/positions follow the appraiser's Web Export Data Dictionary.
// https://www.ircpa.org/media/6549/cama_web-export-data-dictionary.pdf
// This adapter accepts parsed PROPERTY/OWNER/VALUES/etc. rows, not raw NAL rows.
import { normalizeRecord } from '../record.mjs';

const str = value => value == null ? '' : String(value).trim();
function index(rows) {
  const result = new Map();
  for (const row of rows) {
    const id = str(row['Property ID']);
    if (!result.has(id)) result.set(id, []);
    result.get(id).push(row);
  }
  return result;
}
export function indianRiverRecords({ properties, owners = [], values = [], exemptions = [], improvements = [], sales = [], source, restrictionsReviewed = false }) {
  if (restrictionsReviewed !== true) throw new Error('Confirm records are the public, restriction-reviewed export before import.');
  const ownerIndex = index(owners), valueIndex = index(values), exemptionIndex = index(exemptions);
  const improvementIndex = index(improvements), salesIndex = index(sales);
  return properties.map(property => {
    const id = str(property['Property ID']);
    const year = Number(property['Roll Year']);
    const assessed = (valueIndex.get(id) || []).find(row => Number(row.Year) === year);
    const parcelSales = salesIndex.get(id) || [];
    if (typeof property['Geo ID'] !== 'string') throw new Error('Geo ID must be parsed as text to preserve leading zeros.');
    return normalizeRecord({
      county: 'Indian River', parcel_id: str(property['Geo ID']), property_id: id,
      situs_address: str(property['Situs Address']), property_description: str(property['Legal Description']),
      owners: (ownerIndex.get(id) || []).map(owner => ({
        name: [owner['File As Name'], owner['Additional Name']].map(str).filter(Boolean).join(' / '),
        mailing_address: [owner['Street Line 2'], owner['Street Line 3'], owner.City, owner.State, owner.Zip].map(str).filter(Boolean).join(', ')
      })),
      acreage: property['Legal Acres'], property_use_code: str(property['Property Sub Type']), assessment_year: year,
      values: { just: assessed?.['Total Market Value'], assessed: assessed?.['County Assessed Value'], taxable: assessed?.['County Taxable Value'] },
      exemptions: (exemptionIndex.get(id) || []).filter(row => Number(row['Qualify Year']) <= year).map(row => str(row['Exemption Type'])),
      improvements: (improvementIndex.get(id) || []).filter(row => Number(row.Year) === year).map(row => str(row.Description)),
      sales: parcelSales.map(sale => ({ date: str(sale['Sale Date']), price: sale['Sale Price'],
        deed_reference: [sale['Instrument #'], sale['OR Book #'] && `Book ${sale['OR Book #']}`, sale['OR Page #'] && `Page ${sale['OR Page #']}`].filter(Boolean).join('; ') })),
      source, restricted: false
    });
  });
}
