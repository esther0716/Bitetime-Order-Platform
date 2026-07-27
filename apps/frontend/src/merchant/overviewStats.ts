// Moved to @bitetime/shared (packages/shared/src/merchantStats.ts): the Pro revenue export
// builds these same numbers on the backend, and a stat derived on one side of the wire only is
// a file that disagrees with the chart it came from.
//
// This shim keeps the dashboard's importers on their local path. New code should import from
// '@bitetime/shared' directly.
export { computeMerchantStats, granularityFor } from '@bitetime/shared'
export type {
  MerchantStats, SeriesPoint, SeriesWindow, Slice, StatusSlice, Delta, Granularity,
} from '@bitetime/shared'
