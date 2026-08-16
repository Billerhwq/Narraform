import { CONTENT_FIELDS } from './operation-specs.js';

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function enforceFieldPermissions(currentResult, candidate, operationSpec) {
  if (!currentResult) return { ...candidate, unauthorizedChangedFields: [] };
  const result = { ...candidate };
  const unauthorizedChangedFields = [];
  for (const field of CONTENT_FIELDS) {
    if (operationSpec.writableFields.includes(field)) continue;
    if (Object.prototype.hasOwnProperty.call(candidate || {}, field) && JSON.stringify(candidate?.[field]) !== JSON.stringify(currentResult?.[field])) unauthorizedChangedFields.push(field);
    result[field] = clone(currentResult[field]);
  }
  return { ...result, unauthorizedChangedFields };
}
