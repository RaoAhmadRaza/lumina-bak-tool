import { randomUUID } from 'crypto';
import type { IdMap } from './types';

/** Generate a new UUID v4 (Node 20 native) */
export function generateUUID(): string {
  return randomUUID();
}

/** Create a fresh empty IdMap */
export function createIdMap(): IdMap {
  return {
    brands: new Map(),
    categories: new Map(),
    products: new Map(),
    customers: new Map(),
    suppliers: new Map(),
    employees: new Map(),
    invoices: new Map(),
    purchaseOrders: new Map(),
    bankAccounts: new Map(),
    branches: new Map(),
    users: new Map(),
    personLookup: new Map(),
  };
}

/**
 * Register an ID mapping: stores sourceId → UUID in the appropriate map.
 * Returns the generated UUID.
 */
export function registerMapping(
  idMap: IdMap,
  mapKey: keyof Omit<IdMap, 'personLookup'>,
  sourceId: string | number,
  uuid?: string
): string {
  const id = uuid || generateUUID();
  const map = idMap[mapKey] as Map<string | number, string>;
  map.set(typeof sourceId === 'string' ? sourceId : Number(sourceId), id);
  return id;
}

/**
 * Look up a UUID by source ID. Returns undefined if not found.
 */
export function lookupId(
  idMap: IdMap,
  mapKey: keyof Omit<IdMap, 'personLookup'>,
  sourceId: string | number
): string | undefined {
  const map = idMap[mapKey] as Map<string | number, string>;
  return map.get(typeof sourceId === 'string' ? sourceId : Number(sourceId));
}

/**
 * Register a person in the personLookup and the appropriate type map.
 * Returns the UUID.
 */
export function registerPerson(
  idMap: IdMap,
  personId: number,
  identiti: number
): string {
  const uuid = generateUUID();

  // Store in type-specific map
  switch (identiti) {
    case 1: // Supplier
      idMap.suppliers.set(personId, uuid);
      idMap.personLookup.set(personId, { type: 'SUPPLIER', uuid });
      break;
    case 2: // Customer
      idMap.customers.set(personId, uuid);
      idMap.personLookup.set(personId, { type: 'CUSTOMER', uuid });
      break;
    case 3: // Employee
      idMap.employees.set(personId, uuid);
      idMap.personLookup.set(personId, { type: 'EMPLOYEE', uuid });
      break;
    case 4: // Owner
      idMap.personLookup.set(personId, { type: 'OWNER', uuid });
      break;
    default: // Miscellaneous — skip
      break;
  }

  return uuid;
}

/**
 * Resolve a PersonId to a customer or supplier UUID.
 * Used by invoice/PO mappings.
 */
export function resolvePersonId(
  idMap: IdMap,
  personId: number
): { type: string; uuid: string } | undefined {
  return idMap.personLookup.get(personId);
}

/**
 * Export the IdMap to a serializable JSON object (for _id_map.json).
 */
export function serializeIdMap(idMap: IdMap): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  const keys: (keyof Omit<IdMap, 'personLookup'>)[] = [
    'brands', 'categories', 'products', 'customers', 'suppliers',
    'employees', 'invoices', 'purchaseOrders', 'bankAccounts',
    'branches', 'users',
  ];

  for (const key of keys) {
    const map = idMap[key] as Map<string | number, string>;
    const obj: Record<string, string> = {};
    for (const [k, v] of map) {
      obj[String(k)] = v;
    }
    result[key] = obj;
  }

  // personLookup
  const plObj: Record<string, string> = {};
  for (const [k, v] of idMap.personLookup) {
    plObj[String(k)] = `${v.type}:${v.uuid}`;
  }
  result['personLookup'] = plObj;

  return result;
}
