import { tourStockIn } from './tour-stock-in';
import { tourCatalogue } from './tour-catalogue';
import { tourOrders } from './tour-orders';
import { tourReturns } from './tour-returns';
import { tourMoney } from './tour-money';
import { tourTeam } from './tour-team';
import type { TourVignetteContent } from './tour-types';

/** Section 13 — the six vignettes in tab order. Each file is owned by its vignette. */
export const tour: readonly TourVignetteContent[] = [
  tourStockIn,
  tourCatalogue,
  tourOrders,
  tourReturns,
  tourMoney,
  tourTeam,
];
