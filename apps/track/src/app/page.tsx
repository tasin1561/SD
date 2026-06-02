import type { ReactElement } from 'react';
import { SearchForm } from './_components/search-form';

/**
 * Public landing — anonymous AWB tracking lookup.
 *
 * No auth, no shell. Black background, centered card. The form
 * navigates the user to /[awb]; that route SSRs the tracking call.
 */
export default function Home(): ReactElement {
  return (
    <div className="min-h-screen grid place-items-center bg-bg text-text-body p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="text-text-bright font-semibold text-2xl tracking-tight">
            Skydrop
          </div>
          <div className="text-text-faint text-xs mt-1">Parcel tracking</div>
        </div>
        <div className="rounded-[7px] border border-border bg-surface p-6">
          <h1 className="text-text-bright text-base font-semibold mb-1">
            Track your shipment
          </h1>
          <p className="text-text-muted text-xs mb-5">
            Enter the AWB number from your shipping confirmation email or SMS.
          </p>
          <SearchForm />
        </div>
      </div>
    </div>
  );
}
