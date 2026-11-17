import { previewOffer, type CartState, type Offer, type PricingSettings } from '@ravin-sales/domain';
import { Price } from '../../components/Price.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { formatMoney } from '../../lib/format.ts';

interface OfferSheetProps {
  readonly cart: CartState;
  readonly offer: Offer;
  readonly pricing: PricingSettings;
  readonly onApply: () => void;
  readonly onRemove: () => void;
  readonly onClose: () => void;
}

/**
 * The seller chooses, with the customer, between the offer and the regular discount: both totals are
 * shown side by side before anything changes.
 */
export function OfferSheet({ cart, offer, pricing, onApply, onRemove, onClose }: OfferSheetProps) {
  const { t } = useI18n();
  const preview = previewOffer(cart.units, pricing, offer);
  const active = cart.offer !== null;
  const hasNewerPieces = active && cart.units.some((unit) => unit.seq > cart.offer!.appliedAtSeq);

  const footer = preview.applicable ? (
    <>
      {!active || hasNewerPieces ? (
        <button
          type="button"
          onClick={onApply}
          className="press h-14 rounded-2xl bg-primary text-lg font-semibold text-primary-fg shadow-card"
        >
          {active ? t.reapplyOffer : t.applyOffer}
        </button>
      ) : null}
      {active ? (
        <button
          type="button"
          onClick={onRemove}
          className="press h-13 rounded-2xl bg-surface-2 text-base font-semibold"
        >
          {t.removeOffer}
        </button>
      ) : null}
    </>
  ) : null;

  return (
    <Sheet
      title={t.offerName(offer.buyQty, offer.payQty)}
      subtitle={active ? t.offerOn : null}
      closeLabel={t.close}
      onClose={onClose}
      footer={footer}
    >
      {preview.applicable ? (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-2.5">
            <div
              className={`animate-pop rounded-2xl p-4 ${preview.customerSaving >= 0 ? 'bg-tile-green ring-2 ring-free' : 'bg-surface-2'}`}
            >
              <dt className="text-sm font-medium text-muted">{t.offerWith}</dt>
              <dd className="font-display text-2xl font-semibold">
                <Price amount={preview.withOffer} />
              </dd>
            </div>
            <div
              className={`animate-pop rounded-2xl p-4 ${preview.customerSaving < 0 ? 'bg-tile-amber ring-2 ring-promo' : 'bg-surface-2'}`}
            >
              <dt className="text-sm font-medium text-muted">{t.offerWithout(pricing.defaultDiscountPercent)}</dt>
              <dd className="font-display text-2xl font-semibold">
                <Price amount={preview.withoutOffer} />
              </dd>
            </div>
          </dl>
          {preview.customerSaving >= 0 ? (
            <p className="font-semibold text-free">
              {t.offerSaves(`${formatMoney(preview.customerSaving)} ${t.currency}`)}
            </p>
          ) : (
            <p className="rounded-2xl bg-promo-bg p-3 font-semibold text-promo">
              {t.offerCostsMore(`${formatMoney(-preview.customerSaving)} ${t.currency}`)}
            </p>
          )}
          <p className="text-sm text-muted">{t.offerLaterPieces}</p>
        </div>
      ) : (
        <p className="pb-2 text-base">{t.offerNeeds(preview.minUnits)}</p>
      )}
    </Sheet>
  );
}
