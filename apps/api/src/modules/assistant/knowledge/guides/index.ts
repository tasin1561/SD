import type { Guide } from '../knowledge.types';
import { ASSOCIATE_GUIDES } from './associate-guides';
import { SELLER_GUIDES } from './seller-guides';
import { STAFF_GUIDES } from './staff-guides';
import { STORE_GUIDES } from './store-guides';

export const GUIDES: readonly Guide[] = [
  ...SELLER_GUIDES,
  ...STORE_GUIDES,
  ...ASSOCIATE_GUIDES,
  ...STAFF_GUIDES,
];
